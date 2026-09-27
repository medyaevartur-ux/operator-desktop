import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import webpush from 'web-push';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import type { NotificationPayload } from './delivery.js';
import { publicPushPayload } from './notification-policy.js';

const FIREBASE_PROJECT = 'zhivaya-skazka-operator';
export const PUSH_DOMAINS = ['fcm.googleapis.com','push.services.mozilla.com','push.apple.com','notify.windows.com'];
export function permittedPushEndpoint(value:string):boolean {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&
      PUSH_DOMAINS.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain));
  } catch { return false; }
}
function firebaseApp() {
  const existing=getApps().find(app=>app.options.projectId===FIREBASE_PROJECT);
  if(existing)return existing;
  const filename=process.env.FIREBASE_SERVICE_ACCOUNT_PATH||path.resolve('firebase-service-account.json');
  try {
    const account=JSON.parse(readFileSync(filename,'utf8'));
    if(account.project_id!==FIREBASE_PROJECT)throw new Error();
    return initializeApp({projectId:FIREBASE_PROJECT,credential:cert(account)},'zhivaya-chat-v8');
  } catch { throw Object.assign(new Error('FCM is not configured'),{code:'provider_not_configured'}); }
}
export async function deliverPush(device:any,payload:NotificationPayload):Promise<string> {
  if(process.env.PUSH_DRY_RUN==='true')return 'dry-run:'+payload.event_id;
  const data=publicPushPayload(payload);
  if(device.provider==='fcm') {
    if(!device.token)throw Object.assign(new Error(),{code:'invalid-registration-token'});
    return getMessaging(firebaseApp()).send({token:device.token,data,android:{priority:'high',ttl:24*60*60*1000}});
  }
  if(device.provider==='webpush') {
    if(!device.subscription||!permittedPushEndpoint(device.subscription.endpoint))throw Object.assign(new Error(),{code:'invalid-subscription'});
    if(!process.env.WEB_PUSH_PUBLIC_KEY||!process.env.WEB_PUSH_PRIVATE_KEY||!process.env.WEB_PUSH_SUBJECT)throw Object.assign(new Error(),{code:'provider_not_configured'});
    webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT,process.env.WEB_PUSH_PUBLIC_KEY,process.env.WEB_PUSH_PRIVATE_KEY);
    try {
      const result=await webpush.sendNotification(device.subscription,JSON.stringify(data),{TTL:86400,urgency:'high',timeout:10000});
      return String(result.headers.location||'accepted');
    } catch(error:any) {
      throw Object.assign(new Error(),{code:[404,410].includes(error.statusCode)?'invalid-subscription':'webpush_unavailable'});
    }
  }
  throw Object.assign(new Error(),{code:'provider_not_configured'});
}
// Existing visitor actions now enqueue durable records, not direct FCM calls.
export async function sendPushToSession(sessionId:string,title:string,body:string) {
  await pool.query(`INSERT INTO chat_v8_events(session_id,kind,payload,dedupe_key)
    VALUES($1,'operator.request',$2,$3) ON CONFLICT(dedupe_key) DO NOTHING`,
    [sessionId,JSON.stringify({title:title.slice(0,120),body:body.slice(0,300)}),`operator.request:${sessionId}:${Math.floor(Date.now()/60000)}`]);
}

