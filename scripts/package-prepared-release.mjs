import {readFile,writeFile,mkdir,readdir,stat,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/* Загрузчик, который nginx вставляет в <head> магазина: грузит виджет после первого
   действия посетителя или через 12 с простоя, чтобы не мешать первой отрисовке.
   Нажатие кнопки сайта «Открыть чат» до загрузки не теряется: загрузчик запоминает
   его и грузит сразу, виджет выполняет просьбу при старте (window.__zsChatReady). */
const WIDGET_LOADER=`(() => {
  if (window.__zsV8LoaderStarted) return;
  window.__zsV8LoaderStarted = true;
  const events = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"];
  let loading = false, retries = 0, timer;
  const cleanup = () => { clearTimeout(timer); events.forEach(event => window.removeEventListener(event, load)); };
  function load() {
    if (loading || window.__zsWidgetInited) { cleanup(); return; }
    loading = true; cleanup();
    const script = document.createElement("script");
    script.src = "/widget/__BUNDLE__";
    script.async = true;
    script.setAttribute("data-chat-widget", "v8");
    script.setAttribute("data-api", "https://zhivaya-skazka.ru");
    script.onerror = () => {
      script.remove(); loading = false;
      if (++retries <= 3) timer = setTimeout(load, retries * 3000);
      events.forEach(event => window.addEventListener(event, load, { once: true, passive: true }));
    };
    document.body.appendChild(script);
  }
  window.addEventListener("open-chat-widget", () => {
    if (window.__zsChatReady) return;
    window.__zsOpenChatRequested = true;
    load();
  });
  events.forEach(event => window.addEventListener(event, load, { once: true, passive: true }));
  window.addEventListener("online", load);
  timer = setTimeout(load, 12000);
})();
`;
const out=path.resolve(process.argv[2]||path.join(root,'prepared-v8'));
if(!out.startsWith(root+path.sep))throw new Error('Output must stay inside project');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
for(const file of ['package-lock.json','server/package.json','server/package-lock.json','src-tauri/tauri.conf.json']){
  if(JSON.parse(await readFile(path.join(root,file),'utf8')).version!==pkg.version)throw new Error(`Version mismatch in ${file}`);
}
const cargo=await readFile(path.join(root,'src-tauri/Cargo.toml'),'utf8');
if(!cargo.includes(`version = "${pkg.version}"`))throw new Error('Cargo version mismatch');
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
async function tree(directory,prefix=''){
  const entries=[];
  for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(item.isSymbolicLink())throw new Error('Release source must not contain symlinks');
    const name=prefix+item.name,filename=path.join(directory,item.name);
    if(item.isDirectory())entries.push(...await tree(filename,name+'/'));
    else entries.push({path:name,sha256:await hash(filename),size:(await stat(filename)).size});
  }
  return entries;
}
await mkdir(out,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const release=path.join(out,`${pkg.version}-${stamp}`);await mkdir(release);
const serverFiles=[...await tree(path.join(root,'server/src'),'src/'),...await tree(path.join(root,'server/migrations'),'migrations/'),...await tree(path.join(root,'server/dist'),'dist/'),...await tree(path.join(root,'server/scripts'),'scripts/')];
for(const name of ['package.json','package-lock.json','tsconfig.json'])serverFiles.push({path:name,sha256:await hash(path.join(root,'server',name)),size:(await stat(path.join(root,'server',name))).size});
const sourceDigest=createHash('sha256').update(serverFiles.map(file=>`${file.path} ${file.sha256}`).sort().join('\n')).digest('hex');
const buildManifest={version:pkg.version,prepared_at:new Date().toISOString(),source_digest:sourceDigest,files:serverFiles};
await writeFile(path.join(root,'server/build-manifest.json'),JSON.stringify(buildManifest,null,2)+'\n');
const serverArchive=path.join(release,'chat-api.tgz');
execFileSync('tar',['-czf',serverArchive,'-C',path.join(root,'server'),'dist','src','migrations','scripts','package.json','package-lock.json','tsconfig.json','.env.example','build-manifest.json']);
const contents=execFileSync('tar',['-tzf',serverArchive],{encoding:'utf8'}).split(/\r?\n/);
if(contents.some(name=>/(^|\/)(\.env(?!\.example)|firebase-service-account|node_modules|private_uploads|uploads|\.git)/.test(name)))throw new Error('Unexpected private content in archive');
const webArchive=path.join(release,'operator-web.tgz');execFileSync('tar',['-czf',webArchive,'-C',path.join(root,'dist'),'.']);
for(const name of ['widget.js','widget.min.js'])await copyFile(path.join(root,name),path.join(release,name));
const widget=await packWidget(release);
for(const name of ['release_chat.py','prepare_chat_env.py','rollback_chat.py'])await copyFile(path.join(root,'ops',name),path.join(release,name));
await copyFile(path.join(root,'docs/RELEASE-V8.md'),path.join(release,'RELEASE-V8.md'));
const files={};for(const name of await readdir(release))files[name]={sha256:await hash(path.join(release,name)),size:(await stat(path.join(release,name))).size};
const manifest={version:pkg.version,prepared_at:new Date().toISOString(),native_installers_included:false,server_source_digest:sourceDigest,files};
await writeFile(path.join(release,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(out,'LATEST.txt'),release+'\n');
console.log(JSON.stringify({release,version:pkg.version,server_archive_sha256:files['chat-api.tgz'].sha256,web_archive_sha256:files['operator-web.tgz'].sha256,widget_archive_sha256:files['widget-release.tgz'].sha256,widget_loader:widget.loader_file,installers:false},null,2));

/* Виджет для сайта: неизменяемые хешированные бандл и загрузчик + манифест —
   ровно тот архив, который проверяет ops/release_chat.py (unpack_widget). */
async function packWidget(target){
  const staging=path.join(target,'widget-release');await mkdir(staging);
  const sha16=data=>createHash('sha256').update(data).digest('hex').slice(0,16);
  const bundle=await readFile(path.join(root,'widget.min.js'));
  const bundleFile=`widget.v8-${sha16(bundle)}.min.js`;
  const loader=Buffer.from(WIDGET_LOADER.replace('__BUNDLE__',bundleFile));
  const loaderFile=`loader.v8-${sha16(loader)}.js`;
  await copyFile(path.join(root,'widget.js'),path.join(staging,'widget.js'));
  await writeFile(path.join(staging,bundleFile),bundle);await writeFile(path.join(staging,loaderFile),loader);
  const widgetFiles={};for(const name of ['widget.js',bundleFile,loaderFile])widgetFiles[name]=await hash(path.join(staging,name));
  const manifest={version:pkg.version,source_file:'widget.js',bundle_file:bundleFile,loader_file:loaderFile,files:widgetFiles};
  await writeFile(path.join(staging,'widget-release.json'),JSON.stringify(manifest,null,2)+'\n');
  execFileSync('tar',['-czf',path.join(target,'widget-release.tgz'),'-C',staging,'widget.js',bundleFile,loaderFile,'widget-release.json']);
  await rm(staging,{recursive:true});
  return manifest;
}
