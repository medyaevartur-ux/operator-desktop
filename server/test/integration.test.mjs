import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import {io as clientIo} from 'socket.io-client';

dotenv.config({path:new URL('../.env.test',import.meta.url),quiet:true});
const url=new URL(process.env.CHAT_TEST_DATABASE_URL||'postgres://invalid/invalid');
if(!/^\/codex_chat_v8_test_[a-z0-9_]+$/.test(url.pathname)||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Refusing integration tests outside the dedicated test database');
process.env.DATABASE_URL=url.href;
process.env.JWT_SECRET=randomBytes(48).toString('hex');
process.env.PUSH_DRY_RUN='true';
process.env.PRIVATE_UPLOAD_DIR=fileURLToPath(new URL('../.test-uploads/'+randomUUID(),import.meta.url));
const {pool}=await import('../src/db.ts');
const {buildApp}=await import('../src/app.ts');
const {publishPendingEvents,deliverPendingNotifications,captureEscalations}=await import('../src/services/delivery.ts');
let app,serverIo,address,ip=1;
const sockets=[];
const password='Synthetic-only-password-2026';
const headers=actor=>({authorization:'Bearer '+actor.token});
async function actor(role='operator') {
  const id=randomUUID(),installation_id=randomUUID(),email=id+'@v8-test.invalid';
  await pool.query("INSERT INTO chat_operators(id,name,email,password_hash,role,status,is_active) VALUES($1,'Тестовый оператор',$2,$3,$4,'online',true)",[id,email,await bcrypt.hash(password,10),role]);
  const response=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.'+ip++,payload:{email,password,installation_id}});
  assert.equal(response.statusCode,200);
  return {...response.json(),id,installation_id};
}
async function session(owner) {
  const identity=await app.inject({method:'POST',url:'/api/widget/identity',remoteAddress:'203.0.113.'+ip++,payload:{}});
  assert.equal(identity.statusCode,200);
  const {visitor_id,visitor_token}=identity.json();
  const response=await app.inject({method:'POST',url:'/api/widget/sessions',headers:{'x-visitor-id':visitor_id,'x-visitor-token':visitor_token},payload:{visitor_id,visitor_name:'Тестовый посетитель'}});
  assert.equal(response.statusCode,200);
  const result=response.json();
  if(owner)await pool.query("UPDATE widget_chat_sessions SET operator_id=$2,status='with_operator' WHERE id=$1",[result.id,owner.id]);
  return {...result,visitor_id,visitor_token};
}
function visitorMessage(s,message='Тестовое сообщение',extra={}) {
  return app.inject({method:'POST',url:`/api/widget/sessions/${s.id}/messages`,headers:{'x-visitor-id':s.visitor_id,'x-visitor-token':s.visitor_token},payload:{sender:'visitor',message,...extra}});
}
async function socket(auth) {
  const instance=clientIo(address,{path:'/ws',transports:['websocket'],reconnection:false,auth,forceNew:true});sockets.push(instance);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket timeout')),3000);instance.once('connect',()=>{clearTimeout(timer);resolve()});instance.once('connect_error',error=>{clearTimeout(timer);reject(error)})});
  return instance;
}
function join(instance,payload) {return new Promise(resolve=>instance.emit('join_session',payload,resolve))}
before(async()=>{
  const marker=await pool.query("SELECT value FROM chat_v8_test_marker WHERE value='synthetic-only'");assert.equal(marker.rowCount,1);
  await pool.query("UPDATE chat_operators SET is_active=false WHERE email LIKE '%@v8-test.invalid'");
  ({app,io:serverIo}=await buildApp());
  address=await app.listen({port:0,host:'127.0.0.1'});process.env.PUBLIC_ORIGIN=address;
});
after(async()=>{sockets.forEach(item=>item.disconnect());if(app)await app.close();await pool.end()});

test('refresh tokens are hashed, rotate, and revoke a family on late replay',async()=>{
  const op=await actor();
  const saved=await pool.query('SELECT token_hash FROM chat_v8_auth_sessions WHERE operator_id=$1',[op.id]);
  assert.notEqual(saved.rows[0].token_hash,op.refresh_token);
  const refreshed=await app.inject({method:'POST',url:'/api/chat-v8/auth/refresh',payload:{refresh_token:op.refresh_token,installation_id:op.installation_id}});
  assert.equal(refreshed.statusCode,200);assert.notEqual(refreshed.json().refresh_token,op.refresh_token);
  await pool.query("UPDATE chat_v8_auth_sessions SET rotated_at=now()-interval '1 minute' WHERE operator_id=$1 AND replaced_by IS NOT NULL",[op.id]);
  const replay=await app.inject({method:'POST',url:'/api/chat-v8/auth/refresh',payload:{refresh_token:op.refresh_token,installation_id:op.installation_id}});
  assert.equal(replay.statusCode,401);
  assert.equal((await app.inject({url:'/api/auth/me',headers:{authorization:'Bearer '+refreshed.json().token}})).statusCode,401);
});
test('concurrent identical visitor sends create exactly one row, counter and event',async()=>{
  const s=await session(),cid=randomUUID();
  const [a,b]=await Promise.all([visitorMessage(s,'Один запрос',{client_message_id:cid}),visitorMessage(s,'Один запрос',{client_message_id:cid})]);
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.equal(a.json().id,b.json().id);
  assert.equal((await pool.query('SELECT unread_count FROM widget_chat_sessions WHERE id=$1',[s.id])).rows[0].unread_count,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM chat_v8_events WHERE message_id=$1 AND kind='message.created'",[a.json().id])).rows[0].n,1);
  assert.equal((await visitorMessage(s,'Другой текст',{client_message_id:cid})).statusCode,409);
});
test('visitor ownership and operator identity cannot be forged',async()=>{
  const a=await actor(),b=await actor(),s=await session(a);
  assert.equal((await app.inject({method:'POST',url:`/api/sessions/${s.id}/messages`,headers:headers(a),payload:{message:'test',operator_id:b.id}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:`/api/widget/sessions/${s.id}/messages`,headers:{'x-visitor-id':'another-visitor'},payload:{sender:'visitor',message:'test'}})).statusCode,403);
  assert.equal((await visitorMessage(s,'test',{sender:'system'})).statusCode,400);
  assert.equal((await app.inject({method:'PATCH',url:`/api/operators/${a.id}/online`,payload:{is_online:false}})).statusCode,401);
  assert.equal((await app.inject({method:'PATCH',url:`/api/operators/${b.id}/status`,headers:headers(a),payload:{status:'offline'}})).statusCode,403);
});
test('anonymous sockets cannot join by session UUID or receive internal notes',async()=>{
  const op=await actor('admin'),s=await session(op),guest=await socket({visitor_token:s.visitor_token}),outsider=await socket(),staff=await socket({token:op.token});
  assert.equal((await join(outsider,s.id)).ok,false);
  assert.equal((await join(guest,{sessionId:s.id,visitorId:s.visitor_id})).ok,true);
  const guestEvents=[],staffEvents=[],outsiderEvents=[];
  guest.on('new_message',m=>guestEvents.push(m));outsider.on('new_message',m=>outsiderEvents.push(m));staff.on('new_message',m=>staffEvents.push(m));
  const note=await app.inject({method:'POST',url:`/api/sessions/${s.id}/messages`,headers:headers(op),payload:{message:'Заметка для команды',is_internal:true,client_message_id:randomUUID()}});assert.equal(note.statusCode,200);
  await publishPendingEvents(serverIo);await delay(80);
  assert.equal(guestEvents.some(m=>m.id===note.json().id),false);assert.equal(outsiderEvents.length,0);assert.equal(staffEvents.some(m=>m.id===note.json().id),true);
  const history=await app.inject({url:`/api/widget/sessions/${s.id}/messages`,headers:{'x-visitor-id':s.visitor_id,'x-visitor-token':s.visitor_token}});
  assert.equal(history.json().some(m=>m.is_internal),false);
  guest.disconnect();outsider.disconnect();staff.disconnect();
});
test('history cursor preserves microseconds and does not skip messages',async()=>{
  const op=await actor(),s=await session(op);
  await pool.query(`INSERT INTO widget_chat_messages(session_id,sender,message,created_at)
    SELECT $1,'visitor','Строка '||n, '2026-09-14T00:00:00Z'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,27) n`,[s.id]);
  const ids=new Set();let cursor=null,pages=0;
  do {
    const response=await app.inject({url:`/api/sessions/${s.id}/messages?paged=1&limit=10${cursor?'&cursor='+encodeURIComponent(cursor):''}`,headers:headers(op)});
    assert.equal(response.statusCode,200);const data=response.json();data.messages.forEach(m=>ids.add(m.id));cursor=data.next_cursor;
    if(++pages>5)throw new Error('Pagination did not terminate');
  }while(cursor);
  assert.equal(ids.size,27);
});
test('device jobs are deduplicated and can only be acknowledged by their owner',async()=>{
  const owner=await actor(),other=await actor(),s=await session(owner);
  const registration=await app.inject({method:'POST',url:'/api/chat-v8/devices/register',headers:headers(owner),payload:{installation_id:owner.installation_id,platform:'android',provider:'fcm',token:'synthetic-fcm-token-not-a-real-device'}});assert.equal(registration.statusCode,200);
  const message=await visitorMessage(s);assert.equal(message.statusCode,200);
  await publishPendingEvents(serverIo);await publishPendingEvents(serverIo);
  const jobs=await pool.query('SELECT j.* FROM chat_v8_deliveries j JOIN chat_v8_events e ON e.id=j.event_id WHERE e.message_id=$1',[message.json().id]);assert.equal(jobs.rowCount,1);
  await deliverPendingNotifications(serverIo,async()=> 'synthetic-provider-acceptance');
  assert.equal((await pool.query('SELECT status FROM chat_v8_deliveries WHERE id=$1',[jobs.rows[0].id])).rows[0].status,'sent');
  await app.inject({method:'POST',url:`/api/chat-v8/notifications/${jobs.rows[0].id}/ack`,headers:headers(other),payload:{outcome:'read'}});
  assert.equal((await pool.query('SELECT acknowledged_at FROM chat_v8_deliveries WHERE id=$1',[jobs.rows[0].id])).rows[0].acknowledged_at,null);
  await app.inject({method:'POST',url:`/api/chat-v8/notifications/${jobs.rows[0].id}/ack`,headers:headers(owner),payload:{outcome:'read'}});
  assert.equal((await pool.query('SELECT status FROM chat_v8_deliveries WHERE id=$1',[jobs.rows[0].id])).rows[0].status,'acked');
});
test('delivery diagnostics: acknowledgements only move forward and unanswered sends fail after the wait, not before',async()=>{
  const owner=await actor(),s=await session(owner);
  await app.inject({method:'POST',url:'/api/chat-v8/devices/register',headers:headers(owner),payload:{installation_id:owner.installation_id,platform:'android',provider:'fcm',token:'synthetic-fcm-token-diagnostics-only'}});
  const beat=await app.inject({method:'POST',url:'/api/chat-v8/devices/heartbeat',headers:headers(owner),payload:{diagnostics:{permission:'granted',channel_enabled:true,battery_optimized:true}}});
  assert.equal(beat.json().enabled,true);
  const message=await visitorMessage(s);await publishPendingEvents(serverIo);
  const job=(await pool.query('SELECT j.id FROM chat_v8_deliveries j JOIN chat_v8_events e ON e.id=j.event_id WHERE e.message_id=$1',[message.json().id])).rows[0];
  const ack=outcome=>app.inject({method:'POST',url:`/api/chat-v8/notifications/${job.id}/ack`,headers:headers(owner),payload:{outcome}});
  await ack('read');await ack('displayed');await ack('blocked');
  const acked=(await pool.query('SELECT status,ack_outcome,error_code FROM chat_v8_deliveries WHERE id=$1',[job.id])).rows[0];
  assert.deepEqual(acked,{status:'acked',ack_outcome:'read',error_code:null},'a late duplicate or failure does not undo a read notification');
  const devices=(await app.inject({method:'GET',url:'/api/chat-v8/devices',headers:headers(owner)})).json();
  const device=devices.find(item=>item.installation_id===owner.installation_id);
  assert.equal(device.last_ack_outcome,'read');assert.equal(device.diagnostics.battery_optimized,true);assert.equal(device.has_address,true);

  const second=await visitorMessage(s,'Ещё вопрос');await publishPendingEvents(serverIo);
  const pending=(await pool.query('SELECT j.id FROM chat_v8_deliveries j JOIN chat_v8_events e ON e.id=j.event_id WHERE e.message_id=$1',[second.json().id])).rows[0];
  for(let send=0;send<5;send++){
    await pool.query('UPDATE chat_v8_deliveries SET next_attempt_at=now() WHERE id=$1',[pending.id]);
    await deliverPendingNotifications(serverIo,async()=>'synthetic-provider-acceptance');
  }
  let state=(await pool.query('SELECT status,attempts,channel,last_attempt_at FROM chat_v8_deliveries WHERE id=$1',[pending.id])).rows[0];
  assert.equal(state.status,'sent','the fifth send still waits for an acknowledgement');assert.equal(state.attempts,5);assert.equal(state.channel,'fcm');assert.ok(state.last_attempt_at);
  await pool.query('UPDATE chat_v8_deliveries SET next_attempt_at=now() WHERE id=$1',[pending.id]);
  await deliverPendingNotifications(serverIo,async()=>'synthetic-provider-acceptance');
  state=(await pool.query('SELECT status,error_code FROM chat_v8_deliveries WHERE id=$1',[pending.id])).rows[0];
  assert.deepEqual(state,{status:'failed',error_code:'not_acknowledged'});
});
test('operator role cannot change global widget configuration or create administrators',async()=>{
  const op=await actor();
  assert.equal((await app.inject({method:'PUT',url:'/api/settings/widget_config',headers:headers(op),payload:{greeting:'Changed'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/operators',headers:headers(op),payload:{name:'Injected admin',email:'not-real@example.invalid',password,role:'admin'}})).statusCode,403);
});
test('revoking a session invalidates its live access token',async()=>{
  const op=await actor();const sessions=await app.inject({url:'/api/chat-v8/auth/sessions',headers:headers(op)});assert.equal(sessions.statusCode,200);
  const revoked=await app.inject({method:'DELETE',url:'/api/chat-v8/auth/sessions/'+sessions.json()[0].id,headers:headers(op)});assert.equal(revoked.statusCode,200);
  assert.equal((await app.inject({url:'/api/sessions',headers:headers(op)})).statusCode,401);
});
test('a foreign origin is refused on operator routes',async()=>{
  const op=await actor();
  assert.equal((await app.inject({url:'/api/sessions',headers:{...headers(op),origin:'https://untrusted.example'}})).statusCode,403);
});

function multipart(bytes,filename='picture.png') {
  const boundary='chat-v8-fixture-boundary';
  return {contentType:'multipart/form-data; boundary='+boundary,body:Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    bytes,Buffer.from(`\r\n--${boundary}--\r\n`),
  ])};
}
test('visitor files require ownership and reject an HTML file disguised as PNG',async()=>{
  const s=await session(),file=multipart(Buffer.from('<script>not an image</script>'));
  const send=visitor=>app.inject({method:'POST',url:`/api/widget/sessions/${s.id}/messages/upload`,headers:{'content-type':file.contentType,'x-visitor-id':visitor,'x-visitor-token':s.visitor_token},payload:file.body});
  assert.equal((await send('wrong-visitor')).statusCode,403);
  assert.equal((await send(s.visitor_id)).statusCode,415);
});
test('uploaded files use expiring capabilities and retries preserve the original message',async()=>{
  const op=await actor(),s=await session(op),cid=randomUUID();
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2XhQAAAAASUVORK5CYII=','base64');
  const file=multipart(image);
  const send=()=>app.inject({method:'POST',url:`/api/sessions/${s.id}/messages/upload`,headers:{...headers(op),'content-type':file.contentType,'x-client-message-id':cid},payload:file.body});
  const first=await send(),second=await send();
  assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);assert.equal(first.json().id,second.json().id);
  const attachment=first.json().attachments[0],location=new URL(attachment.url);
  assert.equal((await app.inject({url:location.pathname})).statusCode,403);
  assert.equal((await app.inject({url:location.pathname+location.search})).statusCode,200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM chat_v8_files WHERE session_id=$1',[s.id])).rows[0].n,1);
});

test('two operators cannot claim the same conversation and capacity is enforced',async()=>{
  const a=await actor(),b=await actor(),s=await session();
  const claim=op=>app.inject({method:'PATCH',url:`/api/sessions/${s.id}/assign`,headers:headers(op),payload:{operator_id:op.id}});
  const results=await Promise.all([claim(a),claim(b)]);
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,409]);
  const owner=results[0].statusCode===200?a:b;
  await pool.query('UPDATE chat_operators SET max_concurrent_chats=1 WHERE id=$1',[owner.id]);
  const another=await session();
  assert.equal((await app.inject({method:'PATCH',url:`/api/sessions/${another.id}/assign`,headers:headers(owner),payload:{operator_id:owner.id}})).statusCode,409);
});
test('transfer comments stay internal and an unrelated operator cannot close the chat',async()=>{
  const a=await actor(),b=await actor(),outsider=await actor(),s=await session(a);
  const transferred=await app.inject({method:'PATCH',url:`/api/sessions/${s.id}/transfer`,headers:headers(a),payload:{operator_id:b.id,from_operator_id:a.id,comment:'Внутренний контекст передачи'}});
  assert.equal(transferred.statusCode,200);
  assert.equal((await pool.query('SELECT operator_id FROM widget_chat_sessions WHERE id=$1',[s.id])).rows[0].operator_id,b.id);
  const history=await app.inject({url:`/api/widget/sessions/${s.id}/messages`,headers:{'x-visitor-id':s.visitor_id,'x-visitor-token':s.visitor_token}});
  assert.equal(history.json().some(message=>message.message==='Внутренний контекст передачи'),false);
  assert.equal((await app.inject({method:'PATCH',url:`/api/sessions/${s.id}/close`,headers:headers(outsider),payload:{operator_id:outsider.id}})).statusCode,403);
});
test('shared templates reject lost updates instead of overwriting another edit',async()=>{
  const a=await actor(),shortcut='/test-'+randomUUID().slice(0,8);
  const body={title:'Тестовый шаблон',shortcut,body:'Исходный текст',category:'Тест'};
  const created=await app.inject({method:'POST',url:'/api/chat-v8/templates',headers:headers(a),payload:body});assert.equal(created.statusCode,200);
  const original=created.json();
  assert.equal((await app.inject({method:'PUT',url:'/api/chat-v8/templates/'+original.id,headers:headers(a),payload:{...body,body:'Первое изменение',revision:original.revision}})).statusCode,200);
  assert.equal((await app.inject({method:'PUT',url:'/api/chat-v8/templates/'+original.id,headers:headers(a),payload:{...body,body:'Запоздавшая правка',revision:original.revision}})).statusCode,409);
});

test('knowing both visitor and session IDs does not authorize history or socket access',async()=>{
  const s=await session();
  assert.equal((await app.inject({url:`/api/widget/sessions/${s.id}/messages`,headers:{'x-visitor-id':s.visitor_id}})).statusCode,403);
  assert.equal((await join(await socket({}),{sessionId:s.id,visitorId:s.visitor_id})).ok,false);
});
test('late logout from a replaced login does not disable the new device session',async()=>{
  const old=await actor();
  const response=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.'+ip++,payload:{email:old.operator.email,password,installation_id:old.installation_id}});
  assert.equal(response.statusCode,200);
  const fresh={...response.json(),installation_id:old.installation_id};
  assert.equal((await app.inject({method:'POST',url:'/api/chat-v8/devices/register',headers:headers(fresh),payload:{installation_id:old.installation_id,platform:'windows',provider:'socket'}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/chat-v8/auth/logout',payload:{refresh_token:old.refresh_token}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/auth/me',headers:headers(old)})).statusCode,401);
  assert.equal((await app.inject({url:'/api/auth/me',headers:headers(fresh)})).statusCode,200);
  assert.equal((await pool.query('SELECT enabled FROM chat_v8_devices WHERE installation_id=$1',[old.installation_id])).rows[0].enabled,true);
});
test('password changes revoke existing access and disconnect live sockets',async()=>{
  const op=await actor(),connection=await socket({token:op.token});
  assert.equal((await app.inject({method:'PATCH',url:'/api/operators/'+op.id,headers:headers(op),payload:{password:'Changed-synthetic-password-2026'}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/auth/me',headers:headers(op)})).statusCode,401);
  await delay(40);assert.equal(connection.connected,false);
});
test('search history anchor contains the selected message and stays inside its session',async()=>{
  const op=await actor(),s=await session(op),other=await session(),first=(await visitorMessage(s,'Первое')).json();
  await visitorMessage(s,'Следующее');
  const response=await app.inject({url:`/api/sessions/${s.id}/messages?paged=1&around=${first.id}`,headers:headers(op)});
  assert.equal(response.statusCode,200);assert.equal(response.json().messages.at(-1).id,first.id);
  assert.equal((await app.inject({url:`/api/sessions/${other.id}/messages?paged=1&around=${first.id}`,headers:headers(op)})).json().messages.length,0);
});

test('deactivating an operator preserves conversations and returns open ones to the queue',async()=>{
  const admin=await actor('admin'),op=await actor(),s=await session(op);
  assert.equal((await app.inject({method:'DELETE',url:'/api/operators/'+op.id,headers:headers(admin)})).statusCode,200);
  const stored=(await pool.query('SELECT operator_id,status FROM widget_chat_sessions WHERE id=$1',[s.id])).rows[0];
  assert.equal(stored.operator_id,null);assert.equal(stored.status,'waiting_operator');
  assert.equal((await app.inject({url:'/api/auth/me',headers:headers(op)})).statusCode,401);
  assert.equal((await app.inject({url:'/api/sessions/queue',headers:headers(admin)})).json().some(item=>item.id===s.id),true);
});

test('simultaneous session creation from visitor tabs returns one active conversation',async()=>{
  const identity=(await app.inject({method:'POST',url:'/api/widget/identity',remoteAddress:'203.0.113.'+ip++,payload:{}})).json();
  const create=()=>app.inject({method:'POST',url:'/api/widget/sessions',headers:{'x-visitor-id':identity.visitor_id,'x-visitor-token':identity.visitor_token},payload:{visitor_id:identity.visitor_id}});
  const responses=await Promise.all([create(),create(),create()]);
  assert.equal(responses.every(response=>response.statusCode===200),true);
  assert.equal(new Set(responses.map(response=>response.json().id)).size,1);
});

test('a login cannot take over or revoke another operator installation by knowing its ID',async()=>{
  const a=await actor(),b=await actor();
  const response=await app.inject({method:'POST',url:'/api/auth/login',remoteAddress:'198.51.100.'+ip++,payload:{email:b.operator.email,password,installation_id:a.installation_id}});
  assert.equal(response.statusCode,200);assert.notEqual(response.json().installation_id,a.installation_id);
  assert.equal((await app.inject({url:'/api/auth/me',headers:headers(a)})).statusCode,200);
});

test('contact revisions reject a lost update and offline leads create one actionable conversation',async()=>{
  const op=await actor(),s=await session(op),contact={visitor_name:'Тестовое имя',visitor_email:'contact@v8-test.invalid',visitor_phone:null,contact_revision:1};
  assert.equal((await app.inject({method:'PATCH',url:`/api/sessions/${s.id}/contact`,headers:headers(op),payload:contact})).statusCode,200);
  assert.equal((await app.inject({method:'PATCH',url:`/api/sessions/${s.id}/contact`,headers:headers(op),payload:contact})).statusCode,409);
  const identity=(await app.inject({method:'POST',url:'/api/widget/identity',remoteAddress:'203.0.113.'+ip++,payload:{}})).json();
  const payload={visitor_id:identity.visitor_id,client_request_id:randomUUID(),name:'Заявка',email:'lead@v8-test.invalid',message:'Тестовая заявка'};
  const create=()=>app.inject({method:'POST',url:'/api/widget/offline-leads',remoteAddress:'192.0.2.100',headers:{'x-visitor-id':identity.visitor_id,'x-visitor-token':identity.visitor_token},payload});
  const first=await create(),second=await create();assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);
  assert.equal(first.json().session.id,second.json().session.id);assert.equal(first.json().session.status,'waiting_operator');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM widget_offline_leads WHERE visitor_id=$1',[identity.visitor_id])).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM widget_chat_messages WHERE session_id=$1',[first.json().session.id])).rows[0].n,1);
});

test('visitor invitations reject forged identity and duplicate sends',async()=>{
  const op=await actor(),s=await session();
  await pool.query("INSERT INTO site_visitors(visitor_id,is_online,last_seen_at) VALUES($1,true,now()) ON CONFLICT(visitor_id) DO UPDATE SET is_online=true,last_seen_at=now()",[s.visitor_id]);
  const send=()=>app.inject({method:'POST',url:'/api/invitations',headers:headers(op),payload:{visitor_id:s.visitor_id,message:'Тестовое приглашение'}});
  const results=await Promise.all([send(),send()]);
  assert.deepEqual(results.map(item=>item.statusCode).sort(),[200,409]);
  const invitation=results.find(item=>item.statusCode===200).json().invitation;
  const accept='/api/widget/invitations/'+invitation.id+'/accept';
  assert.equal((await app.inject({method:'PATCH',url:accept,payload:{}})).statusCode,403);
  const other=await session();
  assert.equal((await app.inject({method:'PATCH',url:accept,headers:{'x-visitor-id':other.visitor_id,'x-visitor-token':other.visitor_token},payload:{}})).statusCode,404);
  const own=()=>app.inject({method:'PATCH',url:accept,headers:{'x-visitor-id':s.visitor_id,'x-visitor-token':s.visitor_token},payload:{}});
  assert.equal((await own()).statusCode,200);assert.equal((await own()).statusCode,200);
});
test('a visitor who declined is not re-invited by an operator for a while',async()=>{
  const op=await actor(),identity=(await app.inject({method:'POST',url:'/api/widget/identity',remoteAddress:'203.0.113.'+ip++,payload:{}})).json();
  await pool.query("INSERT INTO site_visitors(visitor_id,is_online,last_seen_at) VALUES($1,true,now()) ON CONFLICT(visitor_id) DO UPDATE SET is_online=true,last_seen_at=now()",[identity.visitor_id]);
  const send=()=>app.inject({method:'POST',url:'/api/invitations',headers:headers(op),payload:{visitor_id:identity.visitor_id,message:'Подсказать?'}});
  const first=await send();assert.equal(first.statusCode,200);
  const decline=await app.inject({method:'PATCH',url:'/api/widget/invitations/'+first.json().invitation.id+'/decline',headers:{'x-visitor-id':identity.visitor_id,'x-visitor-token':identity.visitor_token},payload:{}});
  assert.equal(decline.statusCode,200);
  const again=await send();
  assert.equal(again.statusCode,409);
  assert.match(again.json().error||again.body,/отказался/);
});
test('automatic invitations are off by default, need an available operator, respect refusal and do not duplicate',async()=>{
  const {maybeAutoInvite}=await import('../src/services/visitor-tracker.ts');
  const {forgetWidgetConfig}=await import('../src/services/auto-invite.ts');
  const setConfig=async value=>{await pool.query("INSERT INTO chat_settings(key,value) VALUES('widget_config',$1) ON CONFLICT(key) DO UPDATE SET value=$1",[JSON.stringify(value)]);forgetWidgetConfig();};
  const visitor='auto-'+randomUUID(),long=10*60000;
  await pool.query("UPDATE chat_operators SET is_online=false WHERE email LIKE '%@v8-test.invalid'");
  try {
    await setConfig({auto_open_delay:400,mobile_invitation_enabled:true});
    assert.equal(await maybeAutoInvite(visitor,long),null,'legacy auto-open settings do not enable server invitations');
    await setConfig({auto_invite_enabled:true,auto_invite_delay:60,auto_invite_cooldown_hours:24});
    assert.equal(await maybeAutoInvite(visitor,long),null,'nobody is available to answer');
    const op=await actor();await pool.query("UPDATE chat_operators SET is_online=true WHERE id=$1",[op.id]);
    assert.equal(await maybeAutoInvite(visitor,30000),null,'too early');
    const results=await Promise.all([maybeAutoInvite(visitor,long),maybeAutoInvite(visitor,long),maybeAutoInvite(visitor,long)]);
    assert.equal(results.filter(Boolean).length,1,'parallel pings from several tabs create one invitation');
    const saved=await pool.query('SELECT auto_generated FROM proactive_invitations WHERE visitor_id=$1',[visitor]);
    assert.equal(saved.rowCount,1);assert.equal(saved.rows[0].auto_generated,true);
    await pool.query("UPDATE proactive_invitations SET status='declined',declined_at=now() WHERE visitor_id=$1",[visitor]);
    assert.equal(await maybeAutoInvite(visitor,long),null,'a refusal pauses invitations');
    await pool.query("UPDATE proactive_invitations SET created_at=now()-interval '25 hours' WHERE visitor_id=$1",[visitor]);
    assert.ok(await maybeAutoInvite(visitor,long),'invitations may resume after the configured pause');
  } finally {
    await pool.query("UPDATE chat_operators SET is_online=false WHERE email LIKE '%@v8-test.invalid'");
    await pool.query("DELETE FROM chat_settings WHERE key='widget_config'");forgetWidgetConfig();
  }
});
test('widget settings keep valid fields when one is invalid and page rules cannot switch invitations on',async()=>{
  const admin=await actor('admin');
  try {
    const response=await app.inject({method:'PUT',url:'/api/widget-settings/config',headers:headers(admin),payload:{color:'not-a-colour',greeting:'Добрый день',page_rules:[{id:'r1',pattern:'/sale',match_type:'contains',enabled:true,override:{auto_invite_enabled:true,greeting:'Скидки'}}]}});
    assert.equal(response.statusCode,200);
    const body=response.json();
    assert.deepEqual(body.dropped,['color']);
    assert.equal(body.config.greeting,'Добрый день');
    assert.equal(body.config.page_rules[0].override.auto_invite_enabled,undefined);
    assert.equal(body.config.page_rules[0].override.greeting,'Скидки');
    const settings=(await app.inject({method:'GET',url:'/api/widget/settings'})).json().widget_config;
    assert.equal(settings.auto_invite_enabled,false);
    assert.deepEqual(settings.hidden_paths,['/admin','/upload']);
  } finally { await pool.query("DELETE FROM chat_settings WHERE key='widget_config'"); }
});
test('starting a visitor chat concurrently creates one assigned conversation',async()=>{
  const op=await actor(),visitor=randomUUID();
  await pool.query("INSERT INTO site_visitors(visitor_id,current_page) VALUES($1,'https://zhivaya-skazka.ru/')",[visitor]);
  const start=()=>app.inject({method:'POST',url:`/api/visitors/${visitor}/start-chat`,headers:headers(op)});
  const responses=await Promise.all([start(),start(),start()]);
  assert.equal(responses.every(item=>item.statusCode===200),true);
  assert.equal(new Set(responses.map(item=>item.json().session_id)).size,1);
  const row=(await pool.query('SELECT operator_id FROM widget_chat_sessions WHERE id=$1',[responses[0].json().session_id])).rows[0];assert.equal(row.operator_id,op.id);
});
test('visitor pagination uses recent presence and excludes blocked visitors',async()=>{
  const op=await actor(),prefix=randomUUID();
  for(let index=0;index<3;index++)await pool.query("INSERT INTO site_visitors(visitor_id,is_online,last_seen_at) VALUES($1,true,now()-($2::int*interval '1 minute'))",[prefix+'-'+index,index*3]);
  const found=await app.inject({url:`/api/visitors?search=${prefix}&online=true&limit=1`,headers:headers(op)});
  assert.equal(found.statusCode,200);assert.equal(found.json().total,1);assert.equal(found.json().items[0].visitor_id,prefix+'-0');
  const paged=await app.inject({url:`/api/visitors?search=${prefix}&limit=1`,headers:headers(op)});assert.equal(paged.json().total,3);assert.equal(paged.json().has_more,true);
  await pool.query('INSERT INTO widget_blocked_visitors(visitor_id,blocked_by) VALUES($1,$2)',[prefix+'-0',op.id]);
  const remaining=await app.inject({url:`/api/visitors?search=${prefix}`,headers:headers(op)});assert.equal(remaining.json().total,2);
});

test('shutdown completes even while a visitor websocket stays connected',async()=>{
  const {app:closing}=await buildApp();const base=await closing.listen({port:0,host:'127.0.0.1'});
  const client=clientIo(base,{path:'/ws',transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('connect_error',reject)});
  let timeout;const disconnected=new Promise(resolve=>client.once("disconnect",resolve));const stopped=closing.close();
  try{await Promise.race([Promise.all([stopped,disconnected]),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Shutdown blocked by websocket')),2000)})]);assert.equal(client.connected,false)}
  finally{clearTimeout(timeout);client.disconnect();await stopped}
});
