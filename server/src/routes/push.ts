import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {assertActor,operatorOf,uuid} from '../core/security.js';
import {registerDevice} from './devices.js';

export function registerPushRoutes(app:FastifyInstance) {
  app.post('/api/push/register',{preHandler:[(app as any).authenticate]},async request=>{
    const data=z.object({operator_id:uuid.optional(),token:z.string().min(16).max(4096),platform:z.literal('android').optional()}).parse(request.body);
    assertActor(request,data.operator_id);
    const device=await registerDevice(request,{installation_id:operatorOf(request).installation_id,platform:'android',provider:'fcm',token:data.token});
    return {ok:true,device_id:device.id};
  });
  app.post('/api/push/unregister',{preHandler:[(app as any).authenticate]},async request=>{
    const {token}=z.object({token:z.string().min(16).max(4096)}).parse(request.body);
    await pool.query('UPDATE chat_v8_devices SET enabled=false WHERE operator_id=$1 AND installation_id=$2 AND token=$3',[operatorOf(request).id,operatorOf(request).installation_id,token]);
    return {ok:true};
  });
}

