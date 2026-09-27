import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';
const updatesDir=()=>path.resolve(process.env.OPERATOR_UPDATES_DIR||'/var/www/updates/operator-desktop');
export function isNewerRelease(next:string,current:string){return !!semver.valid(next)&&!!semver.valid(current)&&semver.gt(next,current)}
function safeDownload(url:string){try{const value=new URL(url);return value.origin==='https://zhivaya-skazka.ru'&&!value.username&&!value.password&&(value.pathname.startsWith('/api/updater/download/')||value.pathname.startsWith('/updates/operator-desktop/'))}catch{return false}}
const androidManifest=z.object({version:z.string().max(80),version_code:z.number().int().positive().max(2100000000),url:z.string().url().refine(safeDownload),sha256:z.string().regex(/^[a-f0-9]{64}$/i),size:z.number().int().positive().max(250*1024*1024),notes:z.string().max(10000).default('')});
export function registerUpdaterRoutes(app:FastifyInstance){
  app.get('/api/updater/check',async(request,reply)=>{
    const query=z.object({current_version:z.string().max(80).optional()}).parse(request.query);
    reply.header('Cache-Control','no-store');
    try{
      const manifest=JSON.parse(fs.readFileSync(path.join(updatesDir(),'latest.json'),'utf8'));
      if(!query.current_version||!manifest.version||!manifest.platforms||!isNewerRelease(manifest.version,query.current_version))return reply.code(204).send();
      for(const platform of Object.values(manifest.platforms) as any[])if(!platform?.signature||!safeDownload(platform.url))return reply.code(204).send();
      return manifest;
    }catch{return reply.code(204).send()}
  });
  app.get('/api/updater/android',async(request,reply)=>{
    const query=z.object({current_code:z.coerce.number().int().nonnegative().default(0)}).parse(request.query);
    reply.header('Cache-Control','no-store');
    try{const manifest=androidManifest.parse(JSON.parse(fs.readFileSync(path.join(updatesDir(),'android-latest.json'),'utf8')));return manifest.version_code>query.current_code?manifest:reply.code(204).send()}
    catch{return reply.code(204).send()}
  });
  app.get('/api/updater/download/:filename',async(request,reply)=>{
    const filename=z.string().max(160).regex(/^[\w.-]+\.(zip|exe|sig|json|apk)$/).parse((request.params as any).filename);
    const base=updatesDir(),file=path.join(base,filename);
    if(!fs.existsSync(file))return reply.code(404).send({error:'Файл не найден'});
    const real=fs.realpathSync(file);
    if(!real.startsWith(fs.realpathSync(base)+path.sep)||!fs.statSync(real).isFile())return reply.code(404).send({error:'Файл не найден'});
    reply.header('Content-Type','application/octet-stream').header('Content-Disposition',`attachment; filename="${filename}"`).header('Content-Length',fs.statSync(real).size);
    return reply.send(fs.createReadStream(real));
  });
}
