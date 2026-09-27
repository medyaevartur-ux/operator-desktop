import 'dotenv/config';
import { buildApp } from './app.js';
import { pool } from './db.js';
import { deliverPush } from './services/push.js';

async function start() {
  const ready=await pool.query("SELECT to_regclass('chat_v8_events') AS schema,to_regclass('chat_v8_migrations') AS migrations");
  if(!ready.rows[0].schema||!ready.rows[0].migrations)throw new Error('Run the reviewed v8 migrations before starting this release');
  if(!(await pool.query("SELECT 1 FROM chat_v8_migrations WHERE version=$1",["005_delivery_diagnostics.sql"])).rowCount)throw new Error("Apply all reviewed v8 migrations before starting");
  const {app}=await buildApp({backgroundJobs:true,transport:deliverPush});
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;
    await app.close();await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM',()=>void stop());
  process.once('SIGINT',()=>void stop());
  await app.listen({port:Number(process.env.PORT)||3010,host:process.env.HOST||'127.0.0.1'});
  console.log('[chat-v8] ready');
}
start().catch(error=>{console.error('[chat-v8] Startup failed:',error.code||error.message);process.exitCode=1;void pool.end()});

