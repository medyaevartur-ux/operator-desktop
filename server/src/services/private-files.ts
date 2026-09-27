import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const MAX_ATTACHMENT_BYTES=10*1024*1024;
export function privateFileDirectory() { return path.resolve(process.env.PRIVATE_UPLOAD_DIR || 'private_uploads'); }
export function filePath(storageName:string) {
  if(!/^[a-f0-9-]{36}\.bin$/.test(storageName))throw new Error('Invalid storage key');
  return path.join(privateFileDirectory(),storageName);
}
function signature(id:string,expires:string) {
  if(!process.env.JWT_SECRET)throw new Error('JWT_SECRET is required');
  return createHmac('sha256',process.env.JWT_SECRET).update(`chat-v8-file:${id}:${expires}`).digest('base64url');
}
export function downloadUrl(id:string,now=Date.now()) {
  const expires=String(Math.floor(now/1000)+600);
  return `${process.env.PUBLIC_ORIGIN||''}/api/chat-v8/files/${id}?cap=${expires}.${signature(id,expires)}`;
}
export function validFileCapability(id:string,cap:string,now=Date.now()) {
  const parts=cap.match(/^(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if(!parts||Number(parts[1])*1000<now||Number(parts[1])*1000>now+610000)return false;
  const expected=Buffer.from(signature(id,parts[1])),actual=Buffer.from(parts[2]);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function attachmentMime(buffer:Buffer,filename:string):string|null {
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString()))return 'image/gif';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(buffer.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  const extension=path.extname(filename).toLowerCase();
  if(buffer.subarray(0,2).toString()==='PK') {
    if(extension==='.docx')return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if(extension==='.xlsx')return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if(extension==='.zip')return 'application/zip';
  }
  if(extension==='.txt'&&!buffer.includes(0)&&!buffer.toString('utf8').includes('\ufffd'))return 'text/plain';
  return null;
}
export function safeFilename(value:string) {
  return path.basename(value.replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'attachment';
}
export function hydrateAttachments(message:any) {
  if(message.is_deleted)return {...message,message:'',attachments:null};
  let attachments=message.attachments;
  if(typeof attachments==='string'){try{attachments=JSON.parse(attachments)}catch{attachments=[]}}
  return {...message,attachments:Array.isArray(attachments)?attachments.map(file=>file.file_id?{...file,url:downloadUrl(file.file_id)}:file):attachments};
}
