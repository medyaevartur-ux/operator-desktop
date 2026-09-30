#!/usr/bin/env node
// Переносит вложения чата с диска сервера в S3. По умолчанию только показывает план и ничего не меняет.
//   node scripts/files-to-s3.mjs --check         доступ к бакету: записать, прочитать и удалить пробный файл
//   node scripts/files-to-s3.mjs                 план: сколько файлов и мегабайт ещё не в S3
//   node scripts/files-to-s3.mjs --apply         скопировать недостающие и сверить размер каждого
//   node scripts/files-to-s3.mjs --prune-local   удалить с диска только файлы, которые лежат в S3 того же размера
// Запуск из каталога выпуска: cd /opt/alphabet-chat-api/releases/<текущий> && node scripts/files-to-s3.mjs ...
import dotenv from 'dotenv';
import { readdir, stat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

dotenv.config({ path: process.env.CHAT_ENV_FILE || '/opt/alphabet-chat-api/.env.chat-v8', quiet: true });
const { s3Settings, s3Client } = await import('../dist/services/file-store.js');
const settings = s3Settings();
if (!settings) {
  console.error('Нет настроек S3 в .env.chat-v8: нужны CHAT_S3_ENDPOINT, CHAT_S3_BUCKET, CHAT_S3_ACCESS_KEY, CHAT_S3_SECRET_KEY.');
  process.exit(2);
}
const s3 = s3Client(settings);
const Bucket = settings.bucket;
const key = name => `${settings.prefix}files/${name}`;
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--apply') ? 'apply' : process.argv.includes('--prune-local') ? 'prune' : 'plan';
const where = { endpoint: settings.endpoint, region: settings.region, bucket: Bucket, prefix: settings.prefix };

async function remoteSize(name) {
  try { return (await s3.send(new HeadObjectCommand({ Bucket, Key: key(name) }))).ContentLength ?? null; }
  catch (error) { if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null; throw error; }
}

try {
  if (mode === 'check') {
    const probe = `${settings.prefix}healthcheck/${Date.now()}.txt`, started = Date.now();
    await s3.send(new PutObjectCommand({ Bucket, Key: probe, Body: 'ok', ContentType: 'text/plain' }));
    const body = await (await s3.send(new GetObjectCommand({ Bucket, Key: probe }))).Body.transformToString();
    await s3.send(new DeleteObjectCommand({ Bucket, Key: probe }));
    console.log(JSON.stringify({ ok: body === 'ok', ...where, round_trip_ms: Date.now() - started }));
    process.exit(body === 'ok' ? 0 : 1);
  }

  const dir = path.resolve(process.env.PRIVATE_UPLOAD_DIR || 'private_uploads');
  const names = (await readdir(dir).catch(() => [])).filter(name => /^[a-f0-9-]{36}\.bin$/.test(name));
  const summary = { mode, ...where, dir, files: names.length, in_s3: 0, to_copy: 0, bytes_to_copy: 0, copied: 0, removed_local: 0, problems: [] };
  for (const name of names) {
    const local = path.join(dir, name), size = (await stat(local)).size, remote = await remoteSize(name);
    if (remote === size) {
      summary.in_s3++;
      if (mode === 'prune') { await unlink(local); summary.removed_local++; }
      continue;
    }
    summary.to_copy++; summary.bytes_to_copy += size;
    if (mode !== 'apply') continue;
    await s3.send(new PutObjectCommand({ Bucket, Key: key(name), Body: await readFile(local), ContentType: 'application/octet-stream' }));
    if (await remoteSize(name) === size) summary.copied++;
    else summary.problems.push(`${name}: размер в S3 не совпал`);
  }
  summary.mb_to_copy = Math.round(summary.bytes_to_copy / 1048576 * 10) / 10;
  console.log(JSON.stringify(summary));
  process.exit(summary.problems.length ? 1 : 0);
} catch (error) {
  // Имя и текст ошибки без ключей: этого хватает, чтобы понять — адрес, регион или права.
  console.error(JSON.stringify({ ok: false, mode, ...where, error: String(error?.name || 'error'), message: String(error?.message || '').slice(0, 300) }));
  process.exit(1);
}
