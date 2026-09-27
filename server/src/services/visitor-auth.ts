import type {FastifyInstance,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {pool} from '../db.js';

export function verifyVisitor(app:FastifyInstance,token:unknown):string {
  if(typeof token!=='string'||token.length>4096)throw new Error('Visitor authentication required');
  const claims=app.jwt.verify<any>(token);
  if(claims.typ!=='visitor'||claims.iss!=='zhivaya-widget-v8'||typeof claims.visitor_id!=='string')throw new Error('Invalid visitor token');
  return claims.visitor_id;
}
export function requestVisitor(app:FastifyInstance,request:FastifyRequest):string {
  const id=verifyVisitor(app,request.headers['x-visitor-token']);
  if(request.headers['x-visitor-id']!==id)throw new Error('Visitor identity mismatch');
  return id;
}
export function registerVisitorIdentity(app:FastifyInstance) {
  app.post('/api/widget/identity',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(request,reply)=>{
    let id:string;
    const previous=request.headers['x-visitor-token'];
    if(previous) {
      try{id=verifyVisitor(app,previous)}catch{return reply.code(401).send({error:'visitor_session_expired'})}
      if((await pool.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[id])).rowCount)return reply.code(403).send({error:'blocked'});
    } else id=randomUUID();
    return {visitor_id:id,visitor_token:app.jwt.sign({visitor_id:id,typ:'visitor',iss:'zhivaya-widget-v8'},{expiresIn:'30d'}),expires_in:30*86400};
  });
  app.addHook('preHandler',async(request,reply)=>{
    const path=request.url.split('?')[0];
    if(!path.startsWith('/api/widget/sessions')&&!['/api/widget/offline-leads','/api/widget/ab-track'].includes(path))return;
    try {
      const id=requestVisitor(app,request);
      if(request.body&&typeof request.body==='object'&&Object.prototype.hasOwnProperty.call(request.body,'visitor_id')&&(request.body as any).visitor_id!==id)throw new Error();
      if(Object.prototype.hasOwnProperty.call(request.query,'visitor_id')&&(request.query as any).visitor_id!==id)throw new Error();
    } catch{return reply.code(403).send({error:'visitor_auth_required'})}
  });
}
