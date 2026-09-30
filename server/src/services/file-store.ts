import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { filePath, privateFileDirectory } from './private-files.js';

/**
 * Где лежат вложения чата. CHAT_FILE_STORE=s3 — в бакете S3 (Timeweb), иначе на диске сервера, как раньше.
 * Читаем из основного места, а если файла там нет — из второго: ни переезд, ни откат не теряют файлы.
 * Если S3 не ответил при загрузке, файл ложится на диск — отправка не срывается (перенесём скриптом позже).
 */
type Where = 's3' | 'local';
type S3Like = Pick<S3Client, 'send'>;
export interface ChatFileStore {
  mode: Where;
  put(name: string, body: Buffer, mime: string): Promise<Where>;
  open(name: string): Promise<Readable | null>;
  remove(name: string): Promise<void>;
}

export interface S3Settings { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string; pathStyle: boolean }

export function s3Settings(env: NodeJS.ProcessEnv = process.env): S3Settings | null {
  const { CHAT_S3_ENDPOINT, CHAT_S3_BUCKET, CHAT_S3_ACCESS_KEY, CHAT_S3_SECRET_KEY } = env;
  if (!CHAT_S3_ENDPOINT || !CHAT_S3_BUCKET || !CHAT_S3_ACCESS_KEY || !CHAT_S3_SECRET_KEY) return null;
  return {
    endpoint: CHAT_S3_ENDPOINT, region: env.CHAT_S3_REGION || 'ru-1', bucket: CHAT_S3_BUCKET,
    prefix: (env.CHAT_S3_PREFIX ?? 'chat-v8/').replace(/^\/+/, ''),
    accessKeyId: CHAT_S3_ACCESS_KEY, secretAccessKey: CHAT_S3_SECRET_KEY, pathStyle: env.CHAT_S3_PATH_STYLE === 'true',
  };
}

export function s3Client(settings: S3Settings): S3Client {
  return new S3Client({
    region: settings.region, endpoint: settings.endpoint, forcePathStyle: settings.pathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    // Контрольные суммы нового SDK поддерживают не все S3-совместимые хранилища — только где обязательны.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

const missing = (error: any) => error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;

export function createChatFileStore(options: { mode: Where; s3?: S3Like; bucket?: string; prefix?: string; log?: (message: string) => void }): ChatFileStore {
  const { s3, bucket = '', prefix = 'chat-v8/', log = message => console.warn(message) } = options;
  const mode: Where = options.mode === 's3' && s3 ? 's3' : 'local';
  const key = (name: string) => { filePath(name); return `${prefix}files/${name}`; };

  const local = {
    async put(name: string, body: Buffer) {
      await mkdir(privateFileDirectory(), { recursive: true, mode: 0o700 });
      await writeFile(filePath(name), body, { flag: 'wx', mode: 0o600 });
    },
    async open(name: string): Promise<Readable | null> {
      const path = filePath(name);
      return (await stat(path).catch(() => null))?.isFile() ? createReadStream(path) : null;
    },
    remove: (name: string) => unlink(filePath(name)).catch(() => undefined),
  };
  const remote = {
    async put(name: string, body: Buffer, mime: string) {
      await s3!.send(new PutObjectCommand({ Bucket: bucket, Key: key(name), Body: body, ContentType: mime }));
    },
    async open(name: string): Promise<Readable | null> {
      try { return (await s3!.send(new GetObjectCommand({ Bucket: bucket, Key: key(name) }))).Body as Readable; }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    remove: (name: string) => s3!.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(name) })).then(() => undefined, () => undefined),
  };

  return {
    mode,
    async put(name, body, mime) {
      if (mode === 'local') { await local.put(name, body); return 'local'; }
      try { await remote.put(name, body, mime); return 's3'; }
      catch (error: any) {
        log(`[files] S3 недоступен (${String(error?.name || 'error')}), файл ${name} сохранён на диск`);
        await local.put(name, body);
        return 'local';
      }
    },
    async open(name) {
      if (mode === 'local') return (await local.open(name)) ?? (s3 ? await remote.open(name).catch(() => null) : null);
      return (await remote.open(name).catch(error => { log(`[files] S3 не отдал ${name} (${String(error?.name || 'error')}), ищем на диске`); return null; })) ?? await local.open(name);
    },
    async remove(name) { await Promise.all([local.remove(name), s3 ? remote.remove(name) : undefined]); },
  };
}

let store: ChatFileStore | undefined;
/** Хранилище по настройкам сервиса. Без ключей S3 режим s3 не включится: файлы остаются на диске, в журнале предупреждение. */
export function chatFiles(): ChatFileStore {
  if (store) return store;
  const settings = s3Settings();
  const wanted = process.env.CHAT_FILE_STORE === 's3' ? 's3' : 'local';
  if (wanted === 's3' && !settings) console.warn('[files] CHAT_FILE_STORE=s3, но ключи S3 не заданы — файлы остаются на диске');
  store = createChatFileStore({ mode: wanted, s3: settings ? s3Client(settings) : undefined, bucket: settings?.bucket, prefix: settings?.prefix });
  return store;
}
