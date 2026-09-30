import test from 'node:test';
import assert from 'node:assert/strict';
import {inQuietHours,notificationDecision,retryDelay,publicPushPayload} from '../src/services/notification-policy.ts';
import {attachmentMime,safeFilename,downloadUrl,validFileCapability} from '../src/services/private-files.ts';

test('overnight quiet hours follow the operator timezone and end exclusively',()=>{
  const prefs={dnd_start:'22:00',dnd_end:'08:00',timezone:'Asia/Yekaterinburg'};
  assert.equal(inQuietHours(prefs,new Date('2026-09-14T17:00:00Z')),true);
  assert.equal(inQuietHours(prefs,new Date('2026-09-15T02:59:00Z')),true);
  assert.equal(inQuietHours(prefs,new Date('2026-09-15T03:00:00Z')),false);
});
test('manual DND and disabled notification types are respected',()=>{
  assert.equal(notificationDecision({},'dnd','escalation'),'dnd');
  assert.equal(notificationDecision({escalation:false},'online','escalation'),'event_disabled');
  assert.equal(notificationDecision({enabled:false},'online','message.created'),'disabled');
  assert.equal(notificationDecision({},'online','message.created'),null);
});
test('delivery backoff is bounded',()=>{
  assert.equal(retryDelay(1),15);assert.equal(retryDelay(2),30);assert.equal(retryDelay(10),900);
});
test('external push transports cannot receive customer text or names',()=>{
  const full={event_id:'event',delivery_id:'delivery',session_id:'session',message_id:'message',title:'Private customer name',body:'Private conversation',page_url:'https://private.example'};
  const sent=publicPushPayload(full);
  assert.deepEqual(Object.keys(sent).sort(),['body','delivery_id','event_id','message_id','session_id','title']);
  assert.equal(sent.body,'Новое сообщение');
  assert.equal(JSON.stringify(sent).includes('Private'),false);
});
test('attachment type is derived from content, not the supplied MIME',()=>{
  assert.equal(attachmentMime(Buffer.from('<script>bad()</script>'),'picture.png'),null);
  assert.equal(attachmentMime(Buffer.from('89504e470d0a1a0a','hex'),'arbitrary.bin'),'image/png');
  assert.equal(attachmentMime(Buffer.from('%PDF-1.7'),'document.pdf'),'application/pdf');
  assert.equal(safeFilename('../../folder\\report.pdf'),'report.pdf');
});
test('private file links are bound to a file and expire',()=>{
  process.env.JWT_SECRET='test-only-key-that-is-longer-than-thirty-two-characters';
  const now=Date.parse('2026-09-14T00:00:00Z'),id='29b43c52-d6c6-46d3-83df-a55b804ae67c';
  const cap=downloadUrl(id,now).split('cap=')[1];
  assert.equal(validFileCapability(id,cap,now+1000),true);
  assert.equal(validFileCapability('another-file',cap,now+1000),false);
  assert.equal(validFileCapability(id,cap,now+601000),false);
});

test('automatic invitations stay off unless the owner enables them',async()=>{
  const {readAutoInvitePolicy,decideAutoInvite}=await import('../src/services/auto-invite.ts');
  const now=Date.parse('2026-09-28T12:00:00Z');
  const base={hasChat:false,blocked:false,onSiteMs:120000,operatorsOnline:2,lastInvitationAt:null,now};
  assert.equal(decideAutoInvite({...base,policy:readAutoInvitePolicy({})}),'disabled');
  assert.equal(decideAutoInvite({...base,policy:readAutoInvitePolicy({auto_open_delay:400,mobile_invitation_enabled:true})}),'disabled');
  const on=readAutoInvitePolicy({auto_invite_enabled:true,auto_invite_delay:60,auto_invite_cooldown_hours:24});
  assert.equal(decideAutoInvite({...base,policy:on}),'invite');
  assert.equal(decideAutoInvite({...base,policy:on,onSiteMs:30000}),'too_early');
  assert.equal(decideAutoInvite({...base,policy:on,operatorsOnline:0}),'no_operators');
  assert.equal(decideAutoInvite({...base,policy:on,hasChat:true}),'has_chat');
  assert.equal(decideAutoInvite({...base,policy:on,blocked:true}),'blocked');
  assert.equal(decideAutoInvite({...base,policy:on,lastInvitationAt:now-23*3600000}),'recent_invitation');
  assert.equal(decideAutoInvite({...base,policy:on,lastInvitationAt:now-25*3600000}),'invite');
});
test('automatic invitation settings are clamped to safe ranges',async()=>{
  const {readAutoInvitePolicy}=await import('../src/services/auto-invite.ts');
  const policy=readAutoInvitePolicy({auto_invite_enabled:'true',auto_invite_delay:1,auto_invite_cooldown_hours:99999,auto_invite_message:'  '});
  assert.equal(policy.enabled,false,'only a real boolean enables invitations');
  assert.equal(policy.delayMs,15000);
  assert.equal(policy.cooldownMs,720*3600000);
  assert.ok(policy.message.length>10);
});

// Equal-version stable releases must still update a prerelease client.
test('updater compares prerelease versions correctly',async()=>{
  const {isNewerRelease}=await import('../src/routes/updater.ts');
  assert.equal(isNewerRelease('8.0.0','8.0.0-beta.1'),true);
  assert.equal(isNewerRelease('8.0.0-beta.2','8.0.0-beta.1'),true);
  assert.equal(isNewerRelease('7.1.0','8.0.0-beta.1'),false);
  assert.equal(isNewerRelease('invalid','8.0.0'),false);
});
test('chat files go to S3 when it is on, and every file stays readable during the move and after a rollback',async()=>{
  const {createChatFileStore,s3Settings}=await import('../src/services/file-store.ts');
  const {GetObjectCommand,PutObjectCommand}=await import('@aws-sdk/client-s3');
  const {Readable}=await import('node:stream');
  const {mkdtemp,writeFile,readFile}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  process.env.PRIVATE_UPLOAD_DIR=await mkdtemp(path.join(tmpdir(),'chat-files-'));
  const bucket=new Map(),logs=[];let down=false;
  const s3={send:async command=>{
    if(down)throw Object.assign(new Error('offline'),{name:'TimeoutError'});
    if(command instanceof PutObjectCommand){bucket.set(command.input.Key,command.input.Body);return {};}
    if(command instanceof GetObjectCommand){if(!bucket.has(command.input.Key))throw Object.assign(new Error('missing'),{name:'NoSuchKey'});return {Body:Readable.from([bucket.get(command.input.Key)])};}
    return {};
  }};
  const text=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString();};
  const [a,b,c]=['1','2','3'].map(digit=>`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}.bin`);
  const cloud=createChatFileStore({mode:'s3',s3,bucket:'bucket',prefix:'chat-v8/',log:message=>logs.push(message)});
  assert.equal(await cloud.put(a,Buffer.from('photo'),'image/png'),'s3');
  assert.equal(bucket.has(`chat-v8/files/${a}`),true);
  assert.equal(await text(await cloud.open(a)),'photo');
  await writeFile(path.join(process.env.PRIVATE_UPLOAD_DIR,b),'old attachment');
  assert.equal(await text(await cloud.open(b)),'old attachment','a file not copied yet is read from the disk');
  down=true;
  assert.equal(await cloud.put(c,Buffer.from('sent while S3 was down'),'image/png'),'local','an outage never loses the upload');
  assert.equal(await readFile(path.join(process.env.PRIVATE_UPLOAD_DIR,c),'utf8'),'sent while S3 was down');
  assert.match(logs[0],/S3/);
  down=false;
  const disk=createChatFileStore({mode:'local',s3,bucket:'bucket',prefix:'chat-v8/'});
  assert.equal(await text(await disk.open(a)),'photo','after a rollback to the disk, files from S3 still open');
  assert.equal(await disk.open('44444444-4444-4444-8444-444444444444.bin'),null);
  await assert.rejects(cloud.open('../../etc/passwd'),/Invalid storage key/);
  assert.equal(s3Settings({CHAT_S3_ENDPOINT:'https://s3.twcstorage.ru',CHAT_S3_BUCKET:'b'}),null,'without keys S3 stays off');
  const settings=s3Settings({CHAT_S3_ENDPOINT:'https://s3.twcstorage.ru',CHAT_S3_BUCKET:'b',CHAT_S3_ACCESS_KEY:'k',CHAT_S3_SECRET_KEY:'s'});
  assert.equal(settings.region,'ru-1');assert.equal(settings.prefix,'chat-v8/');assert.equal(settings.pathStyle,false);
});
