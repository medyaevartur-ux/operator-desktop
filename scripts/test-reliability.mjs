// Focused v8 regressions. All network, accounts and device storage are synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { webcrypto } from "node:crypto";
import { transform } from "esbuild";
const quiet = { log() {}, warn() {}, error() {} };
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
class ApiError extends Error { constructor(message,status) { super(message);this.status=status; } }
function storage() {
  const values = new Map();
  return { values, getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) };
}
function browser() {
  const timers = new Map(); let next = 0;
  return { window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true}),navigator:{onLine:true,userAgent:"Android"},localStorage:storage(),
    console:quiet,__APP_VERSION__:"8.0.0-test",crypto:webcrypto,Event,Headers,FormData,Response,ApiError,BroadcastChannel:undefined,
    setTimeout:callback=>{timers.set(++next,callback);return next},clearTimeout:id=>timers.delete(id),
    setInterval:callback=>{timers.set(++next,callback);return next},clearInterval:id=>timers.delete(id),timers };
}
async function loadModule(path,context) {
  const input=source(path).replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\r?\n/gm,"").replace(/^export\s+\{[^}]+\}\s+from\s+[^;]+;\r?\n/gm,"");
  const {code}=await transform(input,{loader:"ts",format:"cjs",target:"es2022"});
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,...context});return module.exports;
}
async function authHarness(handler) {
  const environment=browser(),calls=[];
  const pair={token:"access-a",operator:{id:"operator-a",email:"fixture@example.invalid"},expires_in:3600};
  const module=await loadModule("src/lib/auth-session.ts",{...environment,API_BASE:"https://chat.invalid",isNative:()=>false,isAndroid:()=>false,
    fetchWithDeadline:async(path,options)=>{calls.push({path,...options});return handler?handler(path,options,pair):Response.json(pair)} });
  return {...environment,...module,calls,pair};
}
test("web login keeps access in memory and never persists bearer or refresh",async()=>{
  const app=await authHarness();await app.signIn("fixture@example.invalid","synthetic");
  assert.equal(app.getSession().token,"access-a");assert.equal(app.getSession().refresh_token,undefined);
  assert.equal(app.localStorage.getItem("chat_token"),null);
  assert.equal([...app.localStorage.values.values()].some(value=>value.includes("access-a")),false);
  assert.match(JSON.parse(app.calls[0].body).installation_id,/^[a-f0-9-]{36}$/);
});
test("parallel refresh calls share one rotation",async()=>{
  let complete;const app=await authHarness((path,_options,pair)=>path.endsWith("refresh")?new Promise(resolve=>{complete=()=>resolve(Response.json({...pair,token:"access-b"}))}):Response.json(pair));
  await app.signIn("fixture@example.invalid","synthetic");
  const requests=[app.restoreSession(true),app.restoreSession(true),app.restoreSession(true)];complete();await Promise.all(requests);
  assert.equal(app.calls.filter(call=>call.path.endsWith("refresh")).length,1);assert.equal(app.getSession().token,"access-b");
});
test("a late refresh cannot resurrect a signed-out account",async()=>{
  let complete;const app=await authHarness((path,_options,pair)=>path.endsWith("refresh")?new Promise(resolve=>{complete=()=>resolve(Response.json(pair))}):Response.json(pair));
  await app.signIn("fixture@example.invalid","synthetic");const refresh=app.restoreSession(true);const logout=app.signOut();
  assert.equal(await app.restoreSession(),null);complete();await Promise.all([refresh,logout]);
  assert.equal(app.getSession(),null);assert.equal(app.calls.at(-1).path,"/api/chat-v8/auth/logout");assert.equal(app.localStorage.getItem("chat_v8_logged_out"),"true");
});
test("an API response from the previous account is rejected",async()=>{
  const environment=browser();let epoch=1,complete;
  const {api}=await loadModule("src/lib/api.ts",{...environment,authEpoch:()=>epoch,accessToken:async()=>"access-a",getSession:()=>({token:"access-a"}),expireSession(){},fetchWithDeadline:()=>new Promise(resolve=>{complete=()=>resolve(Response.json({private:"old-account"}))})});
  const result=api("/api/sessions");await tick();epoch++;complete();await assert.rejects(result,error=>error.status===499);
});
test("401 refreshes once and retries with the new bearer",async()=>{
  const environment=browser(),bearers=[];let token="old",rotations=0;
  const {api}=await loadModule("src/lib/api.ts",{...environment,authEpoch:()=>1,getSession:()=>({token}),expireSession(){throw new Error("must not log out")},accessToken:async(force)=>{if(force){rotations++;token="new"}return token},fetchWithDeadline:async(_path,options)=>{bearers.push(options.headers.get("Authorization"));return bearers.length===1?Response.json({}, {status:401}):Response.json({ok:true})}});
  assert.equal((await api("/api/sessions")).ok,true);assert.deepEqual(bearers,["Bearer old","Bearer new"]);assert.equal(rotations,1);
});
async function socketHarness() {
  const environment=browser();let created=0,options,token="a";
  const create=initialize=>{const state=initialize(patch=>Object.assign(state,patch));return {getState:()=>state}};
  const io=(_url,opts)=>{created++;options=opts;const socket=new EventEmitter();socket.io=new EventEmitter();socket.connected=false;socket.connectCalls=0;
    socket.connect=()=>{socket.connectCalls++;socket.connected=true;socket.emit("connect");return socket};socket.disconnect=()=>{socket.connected=false;socket.emit("disconnect","io client disconnect");return socket};return socket};
  return {...environment,...await loadModule("src/lib/socket.ts",{...environment,create,io,API_BASE:"https://chat.invalid",getSession:()=>({token}),accessToken:async()=>token}),created:()=>created,options:()=>options,setToken:value=>{token=value}};
}
test("manual reconnect preserves the socket instance and message listeners",async()=>{
  const app=await socketHarness(),socket=app.getSocket();let received=0;socket.on("new_message",()=>received++);
  assert.equal(app.reconnectSocket(),socket);socket.emit("new_message",{});assert.equal(received,1);assert.equal(app.created(),1);assert.equal(app.options().reconnectionAttempts,Infinity);
});
test("online recovery stops after logout and each handshake uses current access",async()=>{
  const app=await socketHarness(),socket=app.getSocket();let token;
  app.options().auth(data=>{token=data.token});await tick();assert.equal(token,"a");app.setToken("b");app.options().auth(data=>{token=data.token});await tick();assert.equal(token,"b");
  app.window.dispatchEvent(new Event("online"));assert.equal(socket.connectCalls,1);app.disconnectSocket();app.window.dispatchEvent(new Event("online"));assert.equal(socket.connectCalls,1);
});
test("FCM rotation updates the installation and logout cancels listeners",async()=>{
  const environment=browser(),calls=[];environment.window.__FCM_TOKEN="first-device-token";
  const heartbeats=[];
  const module=await loadModule("src/lib/fcm.ts",{...environment,isAndroid:()=>true,isNative:()=>true,clientName:()=>"fixture",getSession:()=>({operator:{id:"operator-a"},installation_id:"installation-a"}),
    readDeviceDiagnostics:async()=>({permission:"granted",battery_optimized:true}),
    api:async(path,options)=>{if(path.endsWith("/heartbeat")){heartbeats.push(JSON.parse(options.body||"{}"));return {ok:true,registered:true,enabled:true}}calls.push({path,...options});return {ok:true}}});
  await module.startDeviceRegistration("operator-a");environment.window.dispatchEvent(new Event("fcm-token"));await tick();assert.equal(calls.length,1);
  environment.window.__FCM_TOKEN="rotated-token";environment.window.dispatchEvent(new Event("fcm-token"));await tick();assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].body).token,"rotated-token");
  assert.equal(heartbeats[0].diagnostics.battery_optimized,true,"a fresh registration reports what the phone itself knows");
  module.stopDeviceRegistration();environment.window.dispatchEvent(new Event("fcm-token"));await tick();assert.equal(calls.length,2);
});
test("a device the server disabled registers again on the next heartbeat",async()=>{
  const environment=browser(),calls=[];environment.window.__FCM_TOKEN="token-a";
  const module=await loadModule("src/lib/fcm.ts",{...environment,isAndroid:()=>true,isNative:()=>true,clientName:()=>"fixture",getSession:()=>({operator:{id:"operator-a"},installation_id:"installation-a"}),
    readDeviceDiagnostics:async()=>({permission:"granted"}),
    api:async(path)=>{calls.push(path);return path.endsWith("/heartbeat")?{ok:true,registered:true,enabled:false}:{ok:true}}});
  await module.startDeviceRegistration("operator-a");await tick();await tick();
  assert.equal(calls.filter(path=>path.endsWith("/register")).length,1,"no tight re-registration loop");
  for(const [id,callback] of [...environment.timers]){environment.timers.delete(id);callback();}
  await tick();await tick();
  assert.equal(calls.filter(path=>path.endsWith("/register")).length,2,"a disabled device is registered again on the next timer, without restarting the app");
  module.stopDeviceRegistration();
});
async function outboxHarness(send) {
  const environment=browser(),sent=[];let owner="operator-a",epoch=1,items=[];
  const inbox={activeSession:null,messages:[],loadSessions:async()=>{}};
  const module=await loadModule("src/lib/offline-queue.ts",{...environment,getSession:()=>({operator:{id:owner}}),authEpoch:()=>epoch,
    useInboxStore:{getState:()=>inbox,setState:patch=>Object.assign(inbox,typeof patch==="function"?patch(inbox):patch)},
    sendOperatorMessage:async message=>{sent.push(message);if(send)await send(message);return {id:"saved"}},uploadMessageImage:async()=>({id:"saved-file"})});
  const queue=new module.OfflineQueueService();queue.getAll=async()=>items;queue.enqueue=async item=>{items=[...items.filter(x=>x.tempId!==item.tempId),item]};queue.dequeue=async id=>{items=items.filter(x=>x.tempId!==id)};
  const message={tempId:webcrypto.randomUUID(),clientId:webcrypto.randomUUID(),sessionId:"session-a",operatorId:"operator-a",message:"Fixture",created_at:"2026-09-14T00:00:00Z",isInternal:true};
  items=[message];return {queue,sent,message,items:()=>items,setItems:value=>{items=value},switchAccount:()=>{owner="operator-b";epoch++}};
}
test("outbox retries reuse the message ID and preserve the internal flag",async()=>{
  let count=0;const app=await outboxHarness(async()=>{if(++count===1)throw new TypeError("offline")});
  await app.queue.syncOfflineMessages();assert.equal(app.items().length,1);await app.queue.syncOfflineMessages();
  assert.equal(app.items().length,0);assert.equal(app.sent[0].clientId,app.sent[1].clientId);assert.equal(app.sent[1].isInternal,true);
});
test("permanent send errors remain visible instead of silently retrying forever",async()=>{
  const app=await outboxHarness(async()=>{throw new ApiError("Диалог закрыт",409)});await app.queue.syncOfflineMessages();await app.queue.syncOfflineMessages();
  assert.equal(app.sent.length,1);assert.equal(app.items()[0].error,"Диалог закрыт");
});
test("outbox filters other accounts and refuses an account switch during loading",async()=>{
  const app=await outboxHarness();app.setItems([app.message,{...app.message,tempId:"other",operatorId:"operator-b"}]);await app.queue.syncOfflineMessages();assert.equal(app.sent.length,1);
  const second=await outboxHarness();second.queue.getAll=async()=>{second.switchAccount();return [second.message]};await second.queue.syncOfflineMessages();assert.equal(second.sent.length,0);
});
test("parallel online events cannot send an outbox snapshot twice",async()=>{
  const app=await outboxHarness();let complete;const original=app.queue.getAll;let first=true;
  app.queue.getAll=()=>{if(first){first=false;return new Promise(resolve=>{complete=resolve})}return original()};
  const a=app.queue.syncOfflineMessages(),b=app.queue.syncOfflineMessages();complete([app.message]);await Promise.all([a,b]);assert.equal(app.sent.length,1);
});
const widget = source("widget.js");
function widgetFunction(name, context) {
  const start = widget.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.notEqual(start, -1);
  const end = widget.indexOf("\n  }", start);
  assert.notEqual(end, -1);
  return vm.runInNewContext(`(${widget.slice(start, end + 4)})`, { console: quiet, localStorage:storage(),DRAFT_KEY:"fixture-draft",PENDING_KEY:"fixture-pending",messageId:()=>webcrypto.randomUUID(),primeSound(){}, ...context });
}
function showPolicy(config = {}, extra = {}) {
  const shared = storage(), state = { open: false, session: null, config, pendingInvitation: null, mobileInviteShown: false, idleTimer: null, openReason: null, _autoMinTimer: null };
  const timers = new Set(), calls = [];
  const base = { state, localStorage: shared, sessionStorage: storage(), window: {}, Date, Number, Math, String, clearTimeout: (id) => timers.delete(id), setTimeout: (fn) => { const id = Symbol(); timers.add(id); return id; },
    OPEN_KEY: "zs_widget_open", REFUSED_KEY: "zs_autoshow_refused_until", RESOLVED_INVITE_KEY: "zs_invitation_resolved", autoTimers: timers,
    unlockBodyScroll() {}, api: async (...args) => { calls.push(args); return { ok: true }; }, ...extra };
  base.cancelAutoTimers = widgetFunction("cancelAutoTimers", base);
  base.rememberRefusal = widgetFunction("rememberRefusal", base);
  base.autoShowAllowed = widgetFunction("autoShowAllowed", base);
  base.laterAuto = widgetFunction("laterAuto", base);
  base.closeChat = widgetFunction("closeChat", base);
  base.resolveInvitation = widgetFunction("resolveInvitation", base);
  base.declineInvitation = widgetFunction("declineInvitation", base);
  base.receiveInvitation = widgetFunction("receiveInvitation", base);
  return { ...base, calls, timers };
}
test("automatic offers stay silent unless the owner enables them", () => {
  assert.equal(showPolicy({ auto_open_delay: 400, mobile_invitation_enabled: true }).autoShowAllowed(), false);
  const enabled = showPolicy({ auto_invite_enabled: true });
  assert.equal(enabled.autoShowAllowed(), true);
  enabled.state.session = { id: "chat" };
  assert.equal(enabled.autoShowAllowed(), false, "a visitor who is already chatting is not interrupted");
});
test("closing an automatically opened chat pauses offers in every tab, closing your own chat does not", () => {
  const auto = showPolicy({ auto_invite_enabled: true, auto_invite_cooldown_hours: 24 });
  auto.state.open = true; auto.state.openReason = "auto";
  auto.closeChat("user");
  assert.equal(auto.state.open, false);
  assert.equal(auto.localStorage.getItem("zs_widget_open"), "0", "the next page must not reopen the chat");
  assert.ok(Number(auto.localStorage.getItem("zs_autoshow_refused_until")) > Date.now() + 23 * 3600000);
  assert.equal(auto.autoShowAllowed(), false);
  const own = showPolicy({ auto_invite_enabled: true });
  own.state.open = true; own.state.openReason = "user";
  own.closeChat("user");
  assert.equal(own.localStorage.getItem("zs_widget_open"), "0");
  assert.equal(own.localStorage.getItem("zs_autoshow_refused_until"), null);
});
test("an automatic invitation after a refusal is declined on the server instead of shown", () => {
  const policy = showPolicy({ auto_invite_enabled: true });
  policy.localStorage.setItem("zs_autoshow_refused_until", String(Date.now() + 3600000));
  assert.equal(policy.receiveInvitation({ id: "inv-1", auto: true }), false);
  assert.equal(policy.state.pendingInvitation, null);
  assert.deepEqual(policy.calls[0].slice(0, 2), ["PATCH", "/api/widget/invitations/inv-1/decline"]);
  const manual = showPolicy({});
  assert.equal(manual.receiveInvitation({ id: "inv-2", auto: false }), true, "an operator's personal invitation is still shown");
  manual.declineInvitation("inv-2");
  assert.equal(manual.state.pendingInvitation, null);
  assert.equal(manual.localStorage.getItem("zs_invitation_resolved"), "inv-2", "other tabs hide the same invitation");
});
function autoMessages(config = {}, extra = {}) {
  const state = { open: false, openReason: null, session: null, prechatDone: true, prechat: { enabled: false }, autoWelcome: null, autoTyping: null, autoDue: {}, autoVisits: 1,
    config: { auto_invite_enabled: true, header_title: "Живая Сказка", ...config } };
  const timers = new Map(); let nextTimer = 0;
  const ctx = { state, sounds: 0, localStorage: storage(), sessionStorage: storage(), window: {}, location: { href: "https://zhivaya-skazka.ru/catalog/skazka" }, Date, Number, String, Math,
    AUTO_SEEN_PREFIX: "zw_automsg_", AUTO_VISIT_KEY: "zw_automsg_visit", AUTO_TYPING_MIN_MS: 1500, AUTO_TYPING_POPUP_MS: 2000, AUTO_TYPING_MAX_MS: 10000, CART_PAGE: /cart|checkout|корзин/i,
    playSound: () => { ctx.sounds++; }, scheduleRender() {}, scrollBottom() {},
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout: (id) => { timers.delete(id); },
    autoShowAllowed: () => !state.open && !state.session,
    openChat: (reason, am) => { state.open = true; state.openReason = reason; ctx.autoMessageOnOpen(am || null, reason === "auto"); },
    ...extra };
  for (const name of ["autoMessageText", "autoMessageSender", "autoMessageSeen", "markAutoMessageSeen", "autoMessageOnThisPage", "autoMessageForOpen", "deliverAutoMessage",
    "startAutoTyping", "stopAutoTyping", "autoMessageOnOpen", "fireAutoMessage", "restoreVisitAutoMessage", "autoSenderName"]) ctx[name] = widgetFunction(name, ctx);
  // Выполняет накопленные таймеры и возвращает их задержки.
  ctx.run = () => { const due = [...timers.values()]; timers.clear(); due.forEach((timer) => timer.fn()); return due.map((timer) => timer.ms); };
  ctx.timers = timers;
  return ctx;
}
const greeting = { id: "am_1", enabled: true, trigger: "on_page", delay_seconds: 8, message: "Здравствуйте! Подсказать с выбором?", sender_name: "Команда", show_once: true };
test("the team types the first message, then it stays for the visit and never repeats in this browser", () => {
  const first = autoMessages({ auto_messages: [greeting] });
  first.state.autoDue.am_1 = Date.now() + 7000;
  first.state.open = true;
  first.autoMessageOnOpen(null, false);
  assert.equal(first.state.autoTyping.sender, "Команда");
  assert.equal(first.state.autoWelcome, null, "the text waits for the typing to finish");
  assert.ok(first.run().some((ms) => ms > 6000 && ms <= 7000), "a visitor who opened the chat early sees typing until the rule's time");
  assert.equal(first.state.autoWelcome.text, greeting.message);
  assert.equal(first.sounds, 1);
  assert.equal(first.localStorage.getItem("zw_automsg_am_1"), "1");
  const nextPage = autoMessages({ auto_messages: [greeting] }, { localStorage: first.localStorage, sessionStorage: first.sessionStorage });
  nextPage.restoreVisitAutoMessage(nextPage.state.config);
  assert.equal(nextPage.state.autoWelcome.text, greeting.message, "the next page of the same visit keeps the message to reply to");
  assert.equal(nextPage.state.autoWelcome.at, first.state.autoWelcome.at, "and keeps the moment it was shown");
  const tomorrow = autoMessages({ auto_messages: [greeting] }, { localStorage: first.localStorage });
  tomorrow.restoreVisitAutoMessage(tomorrow.state.config);
  tomorrow.fireAutoMessage(greeting);
  tomorrow.state.open = true;
  tomorrow.autoMessageOnOpen(null, false);
  assert.equal(tomorrow.state.autoWelcome, null);
  assert.equal(tomorrow.state.autoTyping, null, "the same browser never sees the same message twice");
  const visitOnly = { ...greeting, id: "am_2", show_once: false };
  const visit = autoMessages({ auto_messages: [visitOnly] });
  visit.state.open = true; visit.autoMessageOnOpen(null, false); visit.run();
  assert.equal(visit.localStorage.getItem("zw_automsg_am_2"), null);
  assert.equal(autoMessages({ auto_messages: [visitOnly] }, { localStorage: visit.localStorage, sessionStorage: visit.sessionStorage }).autoMessageForOpen({ auto_messages: [visitOnly] }), null);
  assert.equal(autoMessages({ auto_messages: [visitOnly] }, { localStorage: visit.localStorage }).autoMessageForOpen({ auto_messages: [visitOnly] }).id, "am_2", "without «once» it returns on the next visit");
});
test("the rule opens the window and types briefly, while a refusal or another page keeps it shut", () => {
  const popup = autoMessages({ auto_messages: [{ ...greeting, sender_name: "" }] });
  popup.fireAutoMessage({ ...greeting, sender_name: "" });
  assert.equal(popup.state.openReason, "auto");
  assert.ok(popup.run().includes(2000));
  assert.equal(popup.state.autoWelcome.sender, "Живая Сказка", "without a sender name the header title signs the message");
  const refused = autoMessages({ auto_messages: [greeting] }, { autoShowAllowed: () => false });
  refused.fireAutoMessage(greeting);
  assert.equal(refused.state.open, false);
  assert.equal(refused.localStorage.getItem("zw_automsg_am_1"), null, "an unseen message waits until the visitor opens the chat");
  const checkoutOnly = { ...greeting, page_filter: "/checkout" };
  const catalog = autoMessages({ auto_messages: [checkoutOnly] });
  catalog.fireAutoMessage(checkoutOnly);
  assert.equal(catalog.state.open, false);
});
test("an auto message is dropped when the visitor writes first or closes the window, and keeps its sender in history", () => {
  const wrote = autoMessages({ auto_messages: [greeting] });
  wrote.state.open = true; wrote.autoMessageOnOpen(null, false);
  wrote.state.session = { id: "chat" };
  wrote.run();
  assert.equal(wrote.state.autoWelcome, null);
  assert.equal(wrote.localStorage.getItem("zw_automsg_am_1"), null);
  const closed = autoMessages({ auto_messages: [greeting] });
  closed.state.open = true; closed.autoMessageOnOpen(null, false);
  closed.state.open = false; closed.stopAutoTyping();
  closed.run();
  assert.equal(closed.state.autoWelcome, null);
  assert.equal(closed.autoMessageForOpen(closed.state.config).id, "am_1", "it is typed again when the visitor comes back to the chat");
  assert.equal(closed.autoSenderName({ sender: "ai", metadata: '{"kind":"auto_message","sender_name":"Команда"}' }), "Команда");
  assert.equal(closed.autoSenderName({ sender: "ai", metadata: { kind: "buttons" } }), "", "the product guide keeps its own label");
});
test("an operator reply that arrived while the chat was closed is shown on the button and in a notice after a page change", async () => {
  const state = { session: { id: "chat" }, messages: [], open: false, readIds: {} };
  const history = [
    { id: "v1", sender: "visitor", message: "Сейчас обговорю с мужем" },
    { id: "o1", sender: "operator", message: "Какой выбираете?", status: "read" },
    { id: "o2", sender: "operator", message: "Хорошо, ждём", status: "delivered" },
  ];
  const load = widgetFunction("loadMessages", { state, messagesLoadVersion: 0, api: async () => history, scheduleRender() {}, setTimeout() {}, scrollBottom() {}, autoDelivered() {}, markVisibleAsRead() {} });
  await load("chat");
  assert.equal(state.unread, 1, "only the reply the visitor has not read counts");
  assert.equal(state.notice.id, "o2");
  const text = widgetFunction("noticeText", { getMsgImg: (m) => m.image_url || null, getMsgFiles: (m) => m.files || [] });
  assert.equal(text({ message: "  **Хорошо**,\n ждём " }), "Хорошо, ждём");
  assert.equal(text({ image_url: "https://zhivaya-skazka.ru/a.png" }), "📷 Фото");
  assert.equal(text({ message: "", files: [{ url: "/f.pdf" }] }), "📎 Файл");
  assert.equal(text({ message: "а".repeat(200) }).length, 140);
});
test("a pasted screenshot without a file name is attached as a picture", async () => {
  const { pastedFiles } = await loadModule("src/lib/pasted-files.ts", { File, Array, Date });
  const shot = new File([new Uint8Array([137, 80, 78, 71])], "", { type: "image/png" });
  const [named] = pastedFiles({ files: [], items: [{ kind: "file", getAsFile: () => shot }] });
  assert.match(named.name, /^Снимок .+\.png$/);
  assert.equal(named.type, "image/png");
  const photo = new File(["x"], "обложка.jpg", { type: "image/jpeg" });
  assert.equal(pastedFiles({ files: [photo], items: [] })[0], photo, "a file copied in Explorer keeps its name");
  assert.deepEqual(pastedFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }] }), []);
});
test("the chat button lifts above a bar at the bottom of the site and steps aside for a large panel", () => {
  const vh = 812, host = {}, body = {}, html = {};
  const layer = (top, height, style) => ({ parentElement: null, style, box: { top, bottom: top + height, height } });
  const obstruction = under => {
    const launcher = { getClientRects: () => [1], getBoundingClientRect: () => ({ left: 308, width: 56, bottom: 796, height: 56 }) };
    const page = { parentElement: under, style: { position: "static", zIndex: "auto" }, box: { top: 0, bottom: vh, height: vh } };
    const context = { launcherSpot: null, LIFT_MAX: 160, LIFT_GAP: 12, host, window: { innerHeight: vh },
      shadow: { querySelectorAll: () => [launcher] }, getComputedStyle: node => node.style, parseInt, Math, Array,
      document: { body, documentElement: html, elementsFromPoint: () => [host, page, body, html] } };
    for (const node of [page, under].filter(Boolean)) node.getBoundingClientRect = () => node.box;
    return { measure: widgetFunction("launcherObstruction", context), launcher };
  };
  assert.equal(obstruction(layer(vh - 16 - 58, 58, { position: "fixed", zIndex: "9999" })).measure(0), 70, "a mini player bar pushes the button above it");
  const sheet = obstruction(layer(97, vh - 97, { position: "fixed", zIndex: "9999" }));
  assert.equal(sheet.measure(0), Infinity, "a tall sheet hides the button");
  sheet.launcher.getClientRects = () => [];
  assert.equal(sheet.measure(0), Infinity, "a hidden button keeps its last spot and does not flicker back");
  assert.equal(obstruction(null).measure(0), 0, "ordinary page content never moves the button");
  assert.equal(obstruction(layer(0, vh, { position: "fixed", zIndex: "auto" })).measure(0), 0, "a background layer without z-index is ignored");
});
test("page rules keep the widget hidden and an open chat is never moved or hidden", () => {
  const place = ({ allowed = true, open = false, modal = false, obstruction = 0 }) => {
    const vars = new Map();
    const host = { style: { display: "block", getPropertyValue: name => vars.get(name) ?? "", setProperty: (name, value) => vars.set(name, value) } };
    widgetFunction("placeLauncher", { host, state: { open }, parseFloat, Math, isWidgetAllowedOnPage: () => allowed, pageModalOpen: () => modal, launcherObstruction: () => obstruction })();
    return { display: host.style.display, lift: vars.get("--zw-lift") ?? "0px" };
  };
  assert.equal(place({ allowed: false, open: true }).display, "none", "/admin and other hidden pages stay without the widget");
  assert.deepEqual(place({ open: true, modal: true, obstruction: Infinity }), { display: "block", lift: "0px" });
  assert.equal(place({ modal: true }).display, "none");
  assert.deepEqual(place({ obstruction: 70 }), { display: "block", lift: "70px" });
});
test("invitation answers carry the visitor signature", async () => {
  let sent;
  const state = { visitorId: "signed-visitor", visitorToken: "signed-token" };
  const request = widgetFunction("requestApi", { state, API_BASE: "https://chat.invalid", FormData, AbortController, encodeURIComponent, setTimeout, clearTimeout, ensureIdentity: async () => true, fetch: async (url, options) => { sent = { url, ...options }; return Response.json({ ok: true }); } });
  await request("PATCH", "/api/widget/invitations/inv-1/decline", {});
  assert.equal(sent.headers["X-Visitor-Token"], "signed-token");
});
test("a reconnect rejoins the current visitor room and fetches missed messages", () => {
  const events = [], loads = [];
  const socket = { _joinedSessionId: "old", emit: (...args) => events.push(args) };
  const state = { session: { id: "current" }, visitorId: "visitor-owner" };
  const restore = widgetFunction("restoreSessionConnection", { state, loadMessages: (id) => loads.push(id), startVisitorPingTimers() {}, scheduleRender() {} });
  restore(socket);
  restore(socket);
  assert.equal(events.length, 2);
  assert.equal(events[0][1].visitorId, "visitor-owner");
  assert.deepEqual(loads, ["current", "current"]);
});
test("an offline widget send preserves the draft and never claims success", async () => {
  const input = { value: "Помогите с книгой", style: {} };
  const state = { session: { id: "session-a" }, config: {}, messages: [], sending: false };
  const notices = [], loads = [];
  const send = widgetFunction("doSend", { state, api: async () => null, scheduleRender() {}, setTimeout() {}, scrollBottom() {}, showToast: (message) => notices.push(message), loadMessages: (id) => loads.push(id) });
  await send(input);
  assert.equal(state.sending, false);
  assert.equal(state.visitorDraftMessage, "Помогите с книгой");
  assert.equal(state.messages.length, 0);
  assert.match(notices[0], /Не удалось подтвердить/);
  assert.deepEqual(loads, ["session-a"]);
});
test("REST success and the socket echo do not duplicate a sent visitor message", async () => {
  const input = { value: "Одно сообщение", style: {} };
  const state = { session: { id: "session-a" }, config: {}, messages: [], sending: false };
  const saved = { id: "server-message", message: input.value, sender: "visitor" };
  const send = widgetFunction("doSend", { state, api: async () => { state.messages.push(saved); return saved; }, scheduleRender() {}, setTimeout() {}, scrollBottom() {} });
  await send(input);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, "server-message");
});
test("a stale widget history response cannot replace another conversation", async () => {
  const state = { session: { id: "session-b" }, messages: [{ id: "keep-b" }] };
  const load = widgetFunction("loadMessages", { state, messagesLoadVersion: 0, api: async () => [{ id: "old-a" }] });
  await load("session-a");
  assert.equal(state.messages[0].id, "keep-b");
});




test("visitor retries keep the same client ID after an unknown HTTP outcome",async()=>{
  const state={session:{id:"session-a"},config:{},messages:[],sending:false},input={value:"Один ответ",style:{}},bodies=[];
  const send=widgetFunction("doSend",{state,api:async(_method,_path,body)=>{bodies.push(body);return bodies.length===1?null:{id:"saved",...body}},scheduleRender(){},setTimeout(){},scrollBottom(){},showToast(){},loadMessages(){}});
  await send(input);await send(input);assert.equal(bodies.length,2);assert.equal(bodies[0].client_message_id,bodies[1].client_message_id);assert.equal(state.messages.length,1);
});
test("visitor API includes signed identity and never sends site cookies",async()=>{
  const state={visitorId:"signed-visitor",visitorToken:"signed-token"};let sent;
  const request=widgetFunction("requestApi",{state,API_BASE:"https://chat.invalid",FormData,AbortController,encodeURIComponent,setTimeout,clearTimeout,ensureIdentity:async()=>true,fetch:async(url,options)=>{sent={url,...options};return Response.json({id:"ok"})}});
  await request("POST","/api/widget/sessions",{visitor_id:"old-id"});
  assert.equal(sent.headers["X-Visitor-Token"],"signed-token");assert.equal(sent.headers["X-Visitor-Id"],"signed-visitor");assert.equal(sent.credentials,"omit");assert.equal(JSON.parse(sent.body).visitor_id,"signed-visitor");
});

test("a late conversation list response cannot erase fresh unread state",async()=>{
  let state,firstResolve,count=0;
  const create=initialize=>{state=initialize(patch=>Object.assign(state,typeof patch==='function'?patch(state):patch),()=>state);return {getState:()=>state}};
  const module=await loadModule('src/store/inbox.store.ts',{...browser(),create,authEpoch:()=>1,getChatSessions:async()=>++count===1?new Promise(resolve=>{firstResolve=resolve}):[{id:'fresh',unread_count:2}]});
  const first=module.useInboxStore.getState().loadSessions();await module.useInboxStore.getState().loadSessions();firstResolve([{id:'stale',unread_count:0}]);await first;
  assert.equal(state.sessions[0].id,'fresh');assert.equal(state.sessions[0].unread_count,2);
});

test('search can open a conversation outside the loaded inbox at its message anchor',async()=>{
  let state,loaded;
  const create=initialize=>{state=initialize(patch=>Object.assign(state,typeof patch==='function'?patch(state):patch),()=>state);return {getState:()=>state}};
  await loadModule('src/store/inbox.store.ts',{...browser(),create,authEpoch:()=>1,getChatSession:async id=>({id,status:'closed'})});
  state.loadMessages=async id=>{loaded=id};
  await state.goToSearchResult({id:'old-message',session_id:'archived'});
  assert.equal(state.activeSession.id,'archived');assert.equal(state.focusedMessageId,'old-message');assert.equal(loaded,'archived');assert.equal(state.readingLatest,false);
});
test('late search results cannot replace a newer query',async()=>{
  let state,resolveOld;
  const create=initialize=>{state=initialize(patch=>Object.assign(state,typeof patch==='function'?patch(state):patch),()=>state);return {getState:()=>state}};
  await loadModule('src/store/inbox.store.ts',{...browser(),create,authEpoch:()=>1,searchMessagePage:async query=>query==='old'?new Promise(resolve=>{resolveOld=resolve}):{messages:[{id:'fresh'}],total:1,page:1,pages:1}});
  state.setMessageSearchQuery('old');const old=state.searchInMessages();state.setMessageSearchQuery('new');await state.searchInMessages();
  resolveOld({messages:[{id:'stale'}],total:1,page:1,pages:1});await old;assert.equal(state.messageSearchResults[0].id,'fresh');
});

test('a notification opens an older conversation even before the inbox list loads',async()=>{
  let selected,screen,loaded;
  const id='11111111-1111-4111-8111-111111111111',inbox={sessions:[],upsertSession(){},openSession:s=>{selected=s},loadMessages:async value=>{loaded=value}};
  const module=await loadModule('src/lib/open-conversation.ts',{...browser(),getChatSession:async value=>({id:value}),useInboxStore:{getState:()=>inbox},useNavigationStore:{setState:value=>{screen=value}},authEpoch:()=>1,isMobile:()=>true,toast:{error(){}}});
  assert.equal(await module.openConversationFromNotification(id),true);assert.equal(selected.id,id);assert.equal(loaded,id);assert.equal(screen.mobileView,'chat-conversation');
});
test('the widget constructor stops settings that would break the site before saving',async()=>{
  const {firstProblem,hostOnly,pathOnly,sameKind}=await loadModule('src/features/widget-settings/use-widget-settings.ts',browser());
  const draft=patch=>({config:{auto_invite_enabled:false,auto_invite_message:'',offline_mode:'form',offline_redirect_url:'',page_rules:[],...patch.config},prechat:{enabled:false,fields:[],...patch.prechat},hours:{schedule:{mon:{from:'09:00',to:'18:00'}},...patch.hours},domains:{}});
  assert.equal(firstProblem(draft({})),null);
  assert.match(firstProblem(draft({prechat:{enabled:true}})),/форм/);
  assert.match(firstProblem(draft({config:{page_rules:[{enabled:true,pattern:' '}]}})),/Поведение/);
  assert.equal(firstProblem(draft({config:{page_rules:[{enabled:false,pattern:''}]}})),null);
  assert.match(firstProblem(draft({hours:{schedule:{mon:{from:'9',to:'18:00'}}}})),/Часы работы/);
  assert.match(firstProblem(draft({config:{offline_mode:'redirect',offline_redirect_url:'site.ru/contacts'}})),/https:/);
  assert.equal(hostOnly('https://www.Zhivaya-Skazka.ru/page?x=1'),'zhivaya-skazka.ru');
  assert.equal(pathOnly('admin'),'/admin');assert.equal(pathOnly('  '),'');
  assert.deepEqual({...sameKind({hidden_paths:[],color:'#aa5129',avatar_url:null},{hidden_paths:null,color:'#1f2937',avatar_url:'/a.png',unknown:1})},{color:'#1f2937',avatar_url:'/a.png'});assert.deepEqual({...sameKind({a:1},'text')},{});
});
test('a JSON export downloads in the browser and is never silently dropped on Android',async()=>{
  const clicks=[],toasts=[];let saved;
  const load=android=>loadModule('src/lib/tauri-bridge.ts',{...browser(),Blob,isAndroid:()=>android,
    toast:{success:(...args)=>toasts.push(['success',...args]),error:(...args)=>toasts.push(['error',...args])},
    URL:{createObjectURL:blob=>{saved=blob;return 'blob:fixture'},revokeObjectURL(){}},
    document:{createElement:()=>({click(){clicks.push({href:this.href,download:this.download})}})}});
  await (await load(false)).saveJsonFile('report.json',{ok:true});
  assert.deepEqual(clicks,[{href:'blob:fixture',download:'report.json'}]);assert.equal(await saved.text(),'{\n  "ok": true\n}');
  await (await load(true)).saveJsonFile('report.json',{ok:true});
  assert.equal(clicks.length,1,'Android WebView ignores <a download>, so the export must not rely on it');
  assert.equal(toasts[0]?.[0],'error','without the native save the operator sees an error, not silence');
});
