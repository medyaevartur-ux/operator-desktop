import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { pool, transaction } from '../db.js';
import { hashToken, openRotation, sealRotation } from '../core/security.js';

export type PublicOperator = { id: string; name: string; email: string; role: string; avatar_url: string | null; status: string; is_online: boolean; is_active: boolean };
const columns = 'id, name, email, role, avatar_url, status, is_online, is_active';
const unauthorized = () => Object.assign(new Error('Сеанс завершён. Войдите снова.'), { statusCode: 401 });
const ROTATION_GRACE_MS = 5 * 60 * 1000;

export async function activeOperator(id: string, client: Pick<PoolClient, 'query'> = pool): Promise<PublicOperator | null> {
  const { rows } = await client.query(`SELECT ${columns} FROM chat_operators WHERE id=$1 AND is_active=true AND role IN ('admin','supervisor','operator')`, [id]);
  return rows[0] ?? null;
}
function accessMinutes() { return Math.max(5, Math.min(60, Number(process.env.ACCESS_TOKEN_MINUTES) || 20)); }
function refreshDays() { return Math.max(1, Math.min(90, Number(process.env.REFRESH_TOKEN_DAYS) || 30)); }

function makePair(app: FastifyInstance, operator: PublicOperator, session: any, refreshToken: string) {
  return {
    token: app.jwt.sign({ id: operator.id, role: operator.role, sid: session.id, installation_id: session.installation_id, typ: 'access', iss: 'zhivaya-chat-v8' }, { expiresIn: `${accessMinutes()}m` }),
    refresh_token: refreshToken,
    installation_id: session.installation_id,
    expires_in: accessMinutes() * 60,
    refresh_expires_at: session.expires_at,
    operator,
  };
}

export async function createAuthSession(app: FastifyInstance, operator: PublicOperator, installationId: string, clientName: string) {
  const token = randomBytes(48).toString('base64url');
  const rows = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [installationId]);
    const conflict=await client.query('SELECT 1 FROM chat_v8_auth_sessions WHERE installation_id=$1 AND operator_id<>$2 UNION ALL SELECT 1 FROM chat_v8_devices WHERE installation_id=$1 AND operator_id<>$2 LIMIT 1',[installationId,operator.id]);
    if(conflict.rowCount) installationId=randomUUID();
    await client.query('UPDATE chat_v8_auth_sessions SET revoked_at=now(),rotation_envelope=NULL WHERE installation_id=$1 AND revoked_at IS NULL', [installationId]);
    await client.query('UPDATE chat_v8_devices SET enabled=false WHERE installation_id=$1', [installationId]);
    const result = await client.query(
    `INSERT INTO chat_v8_auth_sessions(id, operator_id, family_id, token_hash, installation_id, expires_at, client_name)
     VALUES($1,$2,$3,$4,$5,now()+make_interval(days=>$6),$7) RETURNING *`,
    [randomUUID(), operator.id, randomUUID(), hashToken(token), installationId, refreshDays(), clientName.slice(0, 100)],
    );
    return result.rows;
  });
  (app as any).io.in(`installation:${installationId}`).disconnectSockets(true);
  return makePair(app, operator, rows[0], token);
}

export async function rotateAuthSession(app: FastifyInstance, token: string, installationId: string) {
  const result = await transaction(async client => {
    const { rows } = await client.query('SELECT * FROM chat_v8_auth_sessions WHERE token_hash=$1 FOR UPDATE', [hashToken(token)]);
    const session = rows[0];
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || session.installation_id !== installationId) return null;
    if((await client.query("SELECT 1 FROM chat_v8_auth_sessions WHERE family_id=$1 AND revoked_at IS NOT NULL LIMIT 1",[session.family_id])).rowCount)return null;
    const operator = await activeOperator(session.operator_id, client);
    if (!operator) return null;
    if (session.replaced_by) {
      // Encrypted grace window: the server may commit a rotation whose response never
      // reaches the device (slow disk, dropped network, simultaneous tabs). A retry with
      // the old token gets the same still-unused successor. After the window, or once the
      // successor has been used, reuse revokes the complete token family.
      if (session.rotation_envelope && Date.now() - new Date(session.rotated_at).getTime() <= ROTATION_GRACE_MS) {
        const next = await client.query('SELECT * FROM chat_v8_auth_sessions WHERE id=$1 AND revoked_at IS NULL', [session.replaced_by]);
        if (next.rows[0] && !next.rows[0].replaced_by) return makePair(app, operator, next.rows[0], openRotation(session.rotation_envelope));
      }
      await client.query('UPDATE chat_v8_auth_sessions SET revoked_at=now(), rotation_envelope=NULL WHERE family_id=$1', [session.family_id]);
      return null;
    }
    const nextToken = randomBytes(48).toString('base64url');
    const nextId = randomUUID();
    const { rows: next } = await client.query(
      `INSERT INTO chat_v8_auth_sessions(id,operator_id,family_id,token_hash,installation_id,expires_at,client_name)
       VALUES($1,$2,$3,$4,$5,now()+make_interval(days=>$6),$7) RETURNING *`,
      [nextId, operator.id, session.family_id, hashToken(nextToken), installationId, refreshDays(), session.client_name],
    );
    await client.query('UPDATE chat_v8_auth_sessions SET replaced_by=$2,rotated_at=now(),last_used_at=now(),rotation_envelope=$3 WHERE id=$1', [session.id, nextId, sealRotation(nextToken)]);
    return makePair(app, operator, next[0], nextToken);
  });
  if (!result) throw unauthorized();
  return result;
}

export async function revokeFamily(familyId: string) {
  return transaction(async client => {
    const { rows } = await client.query('SELECT installation_id,operator_id FROM chat_v8_auth_sessions WHERE family_id=$1 LIMIT 1', [familyId]);
    if (!rows[0]) return;
    const session = rows[0];
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [session.installation_id]);
    await client.query('UPDATE chat_v8_auth_sessions SET revoked_at=now(),rotation_envelope=NULL WHERE family_id=$1', [familyId]);
    // A late logout from an earlier login must not disable the newer session.
    await client.query(`UPDATE chat_v8_devices SET enabled=false WHERE installation_id=$1 AND operator_id=$2
      AND NOT EXISTS (SELECT 1 FROM chat_v8_auth_sessions WHERE installation_id=$1 AND operator_id=$2
        AND revoked_at IS NULL AND replaced_by IS NULL AND expires_at>now())`, [session.installation_id, session.operator_id]);
  });
}
export async function revokeRefresh(token: string) {
  const { rows } = await pool.query('SELECT family_id FROM chat_v8_auth_sessions WHERE token_hash=$1', [hashToken(token)]);
  if (!rows[0]) return null;
  await revokeFamily(rows[0].family_id);
  return rows[0].family_id as string;
}

export async function validateAccess(app: FastifyInstance, token: string) {
  try {
    const claims = app.jwt.verify<any>(token);
    if (claims.typ !== 'access' || claims.iss !== 'zhivaya-chat-v8' || !claims.sid || !claims.id) throw unauthorized();
    const { rows } = await pool.query(
      `SELECT a.operator_id FROM chat_v8_auth_sessions a WHERE a.id=$1 AND a.operator_id=$2
       AND a.revoked_at IS NULL AND a.expires_at>now()
       AND NOT EXISTS (SELECT 1 FROM chat_v8_auth_sessions revoked WHERE revoked.family_id=a.family_id AND revoked.revoked_at IS NOT NULL)`,
      [claims.sid, claims.id],
    );
    if (!rows[0]) throw unauthorized();
    const operator = await activeOperator(claims.id);
    if (!operator) throw unauthorized();
    return { ...claims, role: operator.role };
  } catch { throw unauthorized(); }
}
