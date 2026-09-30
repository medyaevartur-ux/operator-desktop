// This worker belongs only to the operator application. API responses are never cached.
const BUILD = { id: 'dev', assets: ['/', '/index.html', '/book-mark.svg', '/manifest.webmanifest'] };
const PREFIX = 'zs-operator-v8-';
const CACHE = PREFIX + BUILD.id;
const UUID = /^[a-f0-9]{8}-[a-f0-9-]{27}$/i;
function database() {
  return new Promise((resolve,reject) => {
    const request=indexedDB.open('zs-operator-push',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('state');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function getState(key) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('state'),request=transaction.objectStore('state').get(key);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);transaction.oncomplete=()=>db.close();
  });
}
async function setState(key,value) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('state','readwrite');
    if(value===null)transaction.objectStore('state').delete(key);else transaction.objectStore('state').put(value,key);
    transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>{db.close();reject(transaction.error)};
  });
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(BUILD.assets))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const owned=(await caches.keys()).filter(key=>key.startsWith(PREFIX));
  // Keep a previous shell for an already-open tab. Never delete another app's caches.
  for(const key of owned.filter(key=>key!==CACHE).slice(0,-1))await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(!event.source?.url || new URL(event.source.url).origin!==self.location.origin)return;
  const data=event.data;
  if(data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
  if(data?.type==='AUTH_CLEAR')event.waitUntil((async()=>{await setState('context',null);for(const notice of await self.registration.getNotifications())notice.close()})());
  if(data?.type==='AUTH_CONTEXT') {
    try {
      const base=new URL(data.apiBase);
      if(base.origin!=='https://zhivaya-skazka.ru' && base.origin!==self.location.origin)return;
      if(!UUID.test(data.installationId)||!UUID.test(data.operatorId))return;
      event.waitUntil(setState('context',{apiBase:base.origin,installationId:data.installationId,operatorId:data.operatorId}));
    } catch { /* Ignore malformed/untrusted messages. */ }
  }
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/ws'))return;
  if(request.mode==='navigate') {
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try { const response=await fetch(request);if(response.ok)await cache.put('/index.html',response.clone());return response; }
      catch { return await cache.match('/index.html') || new Response('Откройте приложение при подключённом интернете',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}}); }
    })());return;
  }
  if(!url.pathname.startsWith('/assets/')&&!['/book-mark.svg','/manifest.webmanifest','/app-icon.png'].includes(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;
  })());
});
async function authenticated(context,path,method='GET',body) {
  if(!path.startsWith('/api/')||path.includes('..'))throw new Error('invalid_path');
  const rotate=async()=>{
    const refreshed=await fetch(context.apiBase+'/api/chat-v8/auth/refresh',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-chat-client':'web'},body:JSON.stringify({installation_id:context.installationId}),signal:AbortSignal.timeout(15000)});
    if(!refreshed.ok)throw new Error('session_unavailable');
    return refreshed.json();
  };
  const session=self.navigator.locks?await self.navigator.locks.request('chat-v8-refresh',rotate):await rotate();
  if(session.operator?.id!==context.operatorId)throw new Error('account_changed');
  const response=await fetch(context.apiBase+path,{method,credentials:'include',headers:{authorization:'Bearer '+session.token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('request_unavailable');
  return response.json();
}
// Каждый push обязан закончиться уведомлением: Safari на iPhone отзывает подписку после нескольких «немых» push.
// Подробности ждём не дольше PUSH_DETAILS_MS, а без входа или сети показываем общее «Новое сообщение»
// из самого push — оно тоже открывает нужный диалог. Повтор того же уведомления тихо заменяет прежнее.
const PUSH_DETAILS_MS=5000;
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let hint={};try{hint=event.data?.json()||{}}catch{/* покажем общее уведомление */}
  const details=(async()=>{
    const context=UUID.test(hint.delivery_id)?await getState('context'):null;
    if(!context)return null;
    const loaded=await authenticated(context,'/api/chat-v8/notifications/'+hint.delivery_id);
    return UUID.test(loaded.session_id)&&(await getState('context'))?.operatorId===context.operatorId?{notice:loaded,context}:null;
  })().catch(()=>null);
  const found=await Promise.race([details,new Promise(resolve=>setTimeout(resolve,PUSH_DETAILS_MS,null))]);
  const notice=found?.notice||{title:hint.title,body:hint.body,session_id:hint.session_id,delivery_id:hint.delivery_id};
  const seen=await getState('seen').catch(()=>null)||[];
  const session=UUID.test(notice.session_id)?notice.session_id:null,fresh=!seen.includes(notice.delivery_id);
  await self.registration.showNotification(notice.title||'Живая Сказка',{body:notice.body||'Новое сообщение',tag:'chat-'+(session||'new'),renotify:fresh,silent:!fresh,icon:'/app-icon.png',badge:'/book-mark.svg',data:{sessionId:session,deliveryId:notice.delivery_id},actions:session&&found?[{action:'read',title:'Прочитано'}]:[]});
  if(fresh&&UUID.test(notice.delivery_id))await setState('seen',[...seen,notice.delivery_id].slice(-500)).catch(()=>undefined);
  // Опоздавшую проверку входа всё равно дожидаемся: иначе телефон может усыпить worker посреди обновления сессии.
  const context=(found||await details)?.context;
  if(context)await authenticated(context,'/api/chat-v8/notifications/'+notice.delivery_id+'/ack','POST',{outcome:'displayed'}).catch(()=>undefined);
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const {sessionId,deliveryId}=event.notification.data||{};
    const open=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).find(client=>new URL(client.url).origin===self.location.origin);
    // Общее уведомление без диалога — просто открываем приложение.
    if(!UUID.test(sessionId)){if(open)await open.focus();else await self.clients.openWindow('/');return;}
    const context=await getState('context');
    if(event.action==='read'&&context) {
      try {await authenticated(context,'/api/sessions/'+sessionId+'/read','PATCH',{});if(UUID.test(deliveryId))await authenticated(context,'/api/chat-v8/notifications/'+deliveryId+'/ack','POST',{outcome:'read'});return;}catch{/* Open the app when the action cannot be confirmed. */}
    }
    if(open){await open.focus();open.postMessage({type:'OPEN_CHAT',sessionId,deliveryId})}
    else await self.clients.openWindow('/?session_id='+encodeURIComponent(sessionId)+'&delivery_id='+encodeURIComponent(deliveryId||''));
  })());
});
