import type { FastifyReply, FastifyRequest } from 'fastify';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const uuid = z.string().uuid();
export type OperatorClaims = { id: string; role: 'admin' | 'supervisor' | 'operator'; sid: string; installation_id: string; typ: 'access'; iss: 'zhivaya-chat-v8' };
export function operatorOf(request: FastifyRequest): OperatorClaims { return request.user as OperatorClaims; }
export function isSupervisor(request: FastifyRequest) { return ['admin', 'supervisor'].includes(operatorOf(request).role); }
export function requireRole(request: FastifyRequest, reply: FastifyReply, roles: string[]): boolean {
  if (roles.includes(operatorOf(request).role)) return true;
  reply.code(403).send({ error: 'Недостаточно прав' });
  return false;
}
export function assertActor(request: FastifyRequest, supplied?: string) {
  const id = operatorOf(request).id;
  if (supplied && supplied !== id) throw Object.assign(new Error('Нельзя действовать от имени другого оператора'), { statusCode: 403 });
  return id;
}
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
function envelopeKey() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  return createHash('sha256').update('chat-v8-rotation-cache:').update(process.env.JWT_SECRET).digest();
}
export function sealRotation(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', envelopeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openRotation(envelope: string): string {
  const buffer = Buffer.from(envelope, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', envelopeKey(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}
