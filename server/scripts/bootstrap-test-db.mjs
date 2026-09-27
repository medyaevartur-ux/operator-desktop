import dotenv from 'dotenv';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
dotenv.config({path:new URL('../.env.test',import.meta.url),quiet:true});
const value=process.env.CHAT_TEST_DATABASE_URL;
if(!value)throw new Error('CHAT_TEST_DATABASE_URL is required');
const url=new URL(value);
if(!/^\/codex_chat_v8_test_[a-z0-9_]+$/.test(url.pathname)||!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Only an explicitly named local test database is allowed');
const db=new pg.Client({connectionString:value});
await db.connect();
try {
  const {rows}=await db.query("SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  if(rows[0].tables===0) {
    const schema=(await readFile(new URL('../test/fixtures/baseline-schema.sql',import.meta.url),'utf8')).replace(/^\\.*$/gm,'');
    await db.query('BEGIN');
    try {
      await db.query(schema);
      await db.query("SET search_path TO public; CREATE TABLE chat_v8_test_marker(value text NOT NULL); INSERT INTO chat_v8_test_marker VALUES('synthetic-only')");
      await db.query('COMMIT');
    } catch(error){await db.query('ROLLBACK');throw error}
  } else {
    const marker=await db.query("SELECT value FROM chat_v8_test_marker WHERE value='synthetic-only'");
    if(!marker.rows.length)throw new Error('Missing synthetic database marker');
  }
} finally {await db.end()}
execFileSync(process.execPath,[fileURLToPath(new URL('./migrate.mjs',import.meta.url)),'--apply'],{
  cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:value},stdio:'inherit',
});
console.log('Synthetic test schema ready');
