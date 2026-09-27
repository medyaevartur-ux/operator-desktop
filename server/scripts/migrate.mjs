import 'dotenv/config';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const apply = process.argv.includes('--apply');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows: baseline } = await db.query("SELECT to_regclass('widget_chat_sessions') AS sessions, to_regclass('chat_operators') AS operators");
  if (!baseline[0].sessions || !baseline[0].operators) throw new Error('Chat baseline is missing; refusing to migrate an unknown database');
  const { rows: registered } = await db.query("SELECT to_regclass('chat_v8_migrations') AS present");
  let applied = registered[0].present ? (await db.query('SELECT version, sha256 FROM chat_v8_migrations')).rows : [];
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  if (apply) {
    await db.query("SELECT pg_advisory_lock(hashtext('zhivaya-chat-v8-migrations'))");
    await db.query('CREATE TABLE IF NOT EXISTS chat_v8_migrations(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    applied = (await db.query('SELECT version,sha256 FROM chat_v8_migrations')).rows;
  }
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    const previous = applied.find(row => row.version === file);
    if (previous) {
      if (previous.sha256 !== sha) throw new Error(`Applied migration checksum changed: ${file}`);
      console.log('Already applied:', file);
      continue;
    }
    console.log(apply ? 'Applying:' : 'Pending:', file, sha);
    if (!apply) continue;
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO chat_v8_migrations(version, sha256) VALUES ($1, $2)', [file, sha]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
} finally {
  if (apply) await db.query("SELECT pg_advisory_unlock(hashtext('zhivaya-chat-v8-migrations'))").catch(() => {});
  await db.end();
}
