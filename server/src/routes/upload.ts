import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pool} from '../db.js';
import {operatorOf,uuid} from '../core/security.js';
import {createMessage} from '../services/messages.js';
import {MAX_ATTACHMENT_BYTES,attachmentMime,safeFilename,filePath,privateFileDirectory,hydrateAttachments,validFileCapability} from '../services/private-files.js';

let uploadsInProgress=0;
const fail=(statusCode:number,message:string)=>Object.assign(new Error(message),{statusCode});
export function registerUploadRoutes(app:FastifyInstance) {
  const handle=(operatorUpload:boolean)=>async(request:any,reply:any)=>{
    if(uploadsInProgress>=4)throw fail(429,'Загрузка занята. Попробуйте через несколько секунд.');
    const sessionId=uuid.parse(request.params.id);
    const actor=operatorUpload?{operator:operatorOf(request)}:{visitorId:String(request.headers['x-visitor-id']||'')};
    const {rows:sessions}=await pool.query('SELECT visitor_id,status FROM widget_chat_sessions WHERE id=$1',[sessionId]);
    if(!sessions[0])throw fail(404,'Диалог не найден');
    if(!operatorUpload&&('visitorId' in actor)&&actor.visitorId!==sessions[0].visitor_id)throw fail(403,'Нет доступа к диалогу');
    const clientId=request.headers['x-client-message-id']?uuid.parse(request.headers['x-client-message-id']):undefined;
    uploadsInProgress++;
    let written:string|undefined,fileId:string|undefined,linked=false;
    try {
      const data=await request.file();
      if(!data)throw fail(400,'Выберите файл');
      const chunks:Buffer[]=[];
      for await(const chunk of data.file)chunks.push(chunk);
      const buffer=Buffer.concat(chunks);
      if(data.file.truncated||buffer.length>MAX_ATTACHMENT_BYTES)throw fail(413,'Максимальный размер файла — 10 МБ');
      if(!buffer.length)throw fail(400,'Файл пуст');
      if(operatorUpload&&data.fields?.operator_id?.value&&data.fields.operator_id.value!==operatorOf(request).id)throw fail(403,'Нельзя отправлять от имени другого оператора');
      const filename=safeFilename(data.filename||'attachment');
      const internal=data.fields?.is_internal?.value==='true';
      if(internal&&!operatorUpload)throw fail(403,'Посетителю недоступны внутренние вложения');
      const mime=attachmentMime(buffer,filename);
      if(!mime)throw fail(415,'Поддерживаются изображения, PDF, текст, DOCX, XLSX и ZIP');
      const sha=createHash('sha256').update(buffer).digest('hex');
      fileId=randomUUID();
      const storageName=fileId+'.bin';
      written=filePath(storageName);
      await mkdir(privateFileDirectory(),{recursive:true,mode:0o700});
      await writeFile(written,buffer,{flag:'wx',mode:0o600});
      await pool.query('INSERT INTO chat_v8_files(id,session_id,operator_id,storage_name,filename,mime_type,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [fileId,sessionId,operatorUpload?operatorOf(request).id:null,storageName,filename,mime,buffer.length,sha]);
      const result=await createMessage(sessionId,{message:filename,client_message_id:clientId,is_internal:internal},actor,{
        type:mime.startsWith('image/')?'image':'file',sha256:sha,
        attachments:[{file_id:fileId,filename,mime_type:mime,size:buffer.length}],
      });
      linked=result.created;
      if(result.created)(app as any).io.emit('session_updated',{session_id:sessionId});
      return hydrateAttachments(result.message);
    } finally {
      uploadsInProgress--;
      if(!linked&&fileId) {
        await pool.query('DELETE FROM chat_v8_files WHERE id=$1',[fileId]).catch(()=>{});
        if(written)await unlink(written).catch(()=>{});
      }
    }
  };
  app.post('/api/sessions/:id/messages/upload',{preHandler:[(app as any).authenticate],config:{rateLimit:{max:30,timeWindow:'1 minute'}}},handle(true));
  app.post('/api/widget/sessions/:id/messages/upload',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},handle(false));
  app.get('/api/chat-v8/files/:id',async(request,reply)=>{
    const id=uuid.parse((request.params as any).id);
    const query=z.object({cap:z.string().max(128).optional(),download:z.string().optional()}).parse(request.query);
    if(!query.cap||!validFileCapability(id,query.cap))return reply.code(403).send({error:'Ссылка недействительна. Откройте диалог заново.'});
    const {rows}=await pool.query(`SELECT f.* FROM chat_v8_files f WHERE f.id=$1
      AND EXISTS(SELECT 1 FROM widget_chat_messages m WHERE m.session_id=f.session_id AND m.is_deleted IS NOT TRUE AND m.attachments @> $2::jsonb)`,
      [id,JSON.stringify([{file_id:id}])]);
    if(!rows[0])return reply.code(404).send({error:'Файл недоступен'});
    const file=rows[0],filename=filePath(file.storage_name);
    if(!(await stat(filename).catch(()=>null))?.isFile())return reply.code(404).send({error:'Файл недоступен'});
    reply.type(file.mime_type).header('Cache-Control','private, no-store');
    const disposition=file.mime_type.startsWith('image/')&&query.download!=='1'?'inline':'attachment';
    reply.header('Content-Disposition',`${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    return reply.send(createReadStream(filename));
  });
}

