# Трек A — Фундамент и гигиена: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить канал доставки обновлений и довезти 5.1.6 (чтобы плашка «Обновить» прилетала), закрыть дыры безопасности high/critical в chat-api, навести гигиену — не задев ВК, виджет и поведения 1–4.

**Architecture:** Сервер `alphabet-chat-api` (Fastify+TS под systemd, запуск `tsx src/server.ts` — правка `src/` + `systemctl restart alphabet-chat-api`). Десктоп — Tauri 2 + React (Vite). Апдейтер: клиент `@tauri-apps/plugin-updater` → endpoint `/api/updater/check` → манифест `/var/www/updates/operator-desktop/latest.json`.

**Tech Stack:** TypeScript, Fastify 5, socket.io, PostgreSQL (pg), Tauri 2, React 19, Vite 7.

**Окружение:** правки сервера — по SSH `root@5.129.241.152`, бэкап `.bak-<дата>` перед каждой правкой. Десктоп-правки — локально `C:\Users\Medya\Projects\operator-desktop`. Тест-харнесс сервера — `curl` с явными ожидаемыми кодами (юнит-тестов в chat-api нет).

---

## Файловая карта

- `chat-api/src/routes/updater.ts` — семвер-сравнение версий (сейчас строковое `===`).
- `chat-api/src/routes/operators.ts` — роут `:id/online` (стр. 188) без auth → caller-aware фикс.
- `chat-api/src/routes/widget.ts` — rate-limit + проверка владения сессией + лимиты ввода.
- `operator-desktop/src/components/updater.tsx` — видимое состояние ошибки `check()`.
- `operator-desktop/src/components/screens/settings-screen.tsx` — кнопка «Проверить обновления».
- `operator-desktop/scripts/release.ps1` (создать) — единая команда выпуска.
- `operator-desktop/docs/superpowers/SECURITY-AUDIT-2026-06-07.md` (создать) — отчёт findings.
- Деплой: `/var/www/updates/operator-desktop/latest.json` + артефакты.

---

## Task 1: Семвер-сравнение в updater.ts (сервер)

**Files:**
- Modify: `/opt/alphabet-chat-api/src/routes/updater.ts`
- Test: ручной `curl` + локальный node-тест функции

- [ ] **Step 1: Бэкап файла на сервере**

```bash
ssh root@5.129.241.152 'cp /opt/alphabet-chat-api/src/routes/updater.ts /opt/alphabet-chat-api/src/routes/updater.ts.bak-20260607'
```

- [ ] **Step 2: Написать тест функции семвер-сравнения (локально, проверка логики)**

Создать локально `C:\Users\Medya\Projects\operator-desktop\scratch\semver-test.mjs`:

```js
// cmpSemver(a,b): >0 если a новее b, 0 равно, <0 a старее
function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
const ok = (c, msg) => console.log((c ? 'PASS' : 'FAIL') + ' ' + msg);
ok(cmpSemver('5.1.6', '5.1.5') > 0, '5.1.6 > 5.1.5');
ok(cmpSemver('5.1.5', '5.1.5') === 0, '5.1.5 == 5.1.5');
ok(cmpSemver('5.1.4', '5.1.5') < 0, '5.1.4 < 5.1.5');
ok(cmpSemver('5.2.0', '5.1.9') > 0, '5.2.0 > 5.1.9');
ok(cmpSemver('6.0.0', '5.9.9') > 0, '6.0.0 > 5.9.9');
```

- [ ] **Step 3: Прогнать тест — убедиться все PASS**

Run: `node C:\Users\Medya\Projects\operator-desktop\scratch\semver-test.mjs`
Expected: 5 строк `PASS`.

- [ ] **Step 4: Внести правку в updater.ts на сервере**

Заменить блок сравнения. Было:
```ts
    if (manifest.version === current_version) {
      reply.code(204).send();
      return;
    }
    return manifest;
```
Стало (добавить хелпер вверху файла и логику):
```ts
function cmpSemver(a: string, b: string): number {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
```
```ts
    // Предлагаем обновление ТОЛЬКО если манифест строго новее текущей версии клиента.
    if (!current_version || cmpSemver(manifest.version, current_version) <= 0) {
      reply.code(204).send();
      return;
    }
    return manifest;
```

- [ ] **Step 5: Рестарт сервиса**

```bash
ssh root@5.129.241.152 'systemctl restart alphabet-chat-api && sleep 2 && systemctl is-active alphabet-chat-api'
```
Expected: `active`

- [ ] **Step 6: Проверить поведение через curl**

```bash
ssh root@5.129.241.152 '
echo -n "старее(5.1.4): "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3010/api/updater/check?current_version=5.1.4"
echo -n "равно(5.1.5):  "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3010/api/updater/check?current_version=5.1.5"
echo -n "новее(5.2.0):  "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3010/api/updater/check?current_version=5.2.0"'
```
Expected: `старее → 200`, `равно → 204`, `новее → 204`.

---

## Task 2: Видимое состояние ошибки апдейтера + ручная проверка (десктоп)

**Files:**
- Modify: `C:\Users\Medya\Projects\operator-desktop\src\components\updater.tsx`
- Modify: `C:\Users\Medya\Projects\operator-desktop\src\components\screens\settings-screen.tsx`

- [ ] **Step 1: Прочитать текущий updater.tsx целиком** (уже известен: status idle|available|downloading|ready; ошибки `check()` уходят в `console.error`).

- [ ] **Step 2: Добавить состояние ошибки в updater.tsx**

В `useState` тип статуса расширить на `"error"`. В `catch` блока авто-проверки (`checkUpdate`) выставлять видимое состояние:
```ts
} catch (e) {
  console.error("Update check failed:", e);
  setDebugInfo("Проверка обновлений недоступна: " + ((e as any)?.message || e));
  setStatus("error");
}
```
Добавить рендер для `status === "error"` (ненавязчивый, с кнопкой «Скрыть» → `setStatus("idle")`):
```tsx
{status === "error" && (
  <>
    <div className={s.title}>⚠️ Не удалось проверить обновления</div>
    <div className={s.desc}>{debugInfo}</div>
    <div className={s.btnRow}>
      <button className={s.laterBtn} onClick={() => setStatus("idle")}>Скрыть</button>
    </div>
  </>
)}
```

- [ ] **Step 3: Экспортировать ручную проверку**

В `updater.tsx` вынести функцию проверки в экспортируемый хелпер для кнопки в настройках:
```ts
export async function checkForUpdatesManually(): Promise<string> {
  const update = await check();
  if (update) return "Доступна версия v" + update.version;
  return "У вас последняя версия";
}
```
(импортировать `check` уже есть в файле.)

- [ ] **Step 4: Кнопка «Проверить обновления» в settings-screen.tsx**

Прочитать `settings-screen.tsx`, найти секцию профиля/о приложении. Добавить кнопку, вызывающую `checkForUpdatesManually()` и показывающую результат через `alert`/тост:
```tsx
import { checkForUpdatesManually } from "@/components/updater";
// ...
<button onClick={async () => {
  try { alert(await checkForUpdatesManually()); }
  catch (e: any) { alert("Ошибка проверки: " + (e?.message || e)); }
}}>Проверить обновления</button>
```

- [ ] **Step 5: Проверка сборки фронта**

Run: `cd C:\Users\Medya\Projects\operator-desktop && npm run build`
Expected: сборка проходит без TS-ошибок.

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Medya\Projects\operator-desktop
git add src/components/updater.tsx src/components/screens/settings-screen.tsx
git commit -m "feat(updater): видимое состояние ошибки проверки + ручная проверка в настройках"
```

---

## Task 3: Release-скрипт одной командой (десктоп)

**Files:**
- Create: `C:\Users\Medya\Projects\operator-desktop\scripts\release.ps1`

- [ ] **Step 1: Написать скрипт release.ps1**

Скрипт: принимает `-Version` и `-Notes`; (1) проверяет наличие `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; (2) проставляет версию в `package.json` и `src-tauri/tauri.conf.json`; (3) `npm run tauri build`; (4) копирует `*_<ver>_x64-setup.nsis.zip` + `.sig` в `releases/`; (5) печатает готовый JSON для `latest.json` (с подписью из `.sig`) и пошаговые команды деплоя на сервер.

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Notes
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) { throw "TAURI_SIGNING_PRIVATE_KEY не задан в окружении" }

# 1. версия в package.json
$pkgPath = Join-Path $root "package.json"
$pkg = Get-Content $pkgPath -Raw
$pkg = $pkg -replace '("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")', "`${1}$Version`${2}"
Set-Content $pkgPath $pkg -Encoding utf8 -NoNewline

# 2. версия в tauri.conf.json
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw
$conf = $conf -replace '("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")', "`${1}$Version`${2}"
Set-Content $confPath $conf -Encoding utf8 -NoNewline

# 3. сборка
Push-Location $root
npm run tauri build
Pop-Location

# 4. копирование артефактов
$bundle = Join-Path $root "src-tauri\target\release\bundle\nsis"
$zip = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.nsis.zip" | Select-Object -First 1
$sig = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.nsis.zip.sig" | Select-Object -First 1
if (-not $zip -or -not $sig) { throw "Не найдены артефакты сборки для версии $Version" }
$rel = Join-Path $root "releases"
if (-not (Test-Path $rel)) { New-Item -ItemType Directory $rel | Out-Null }
Copy-Item $zip.FullName $rel -Force
Copy-Item $sig.FullName $rel -Force

# 5. готовый latest.json
$signature = (Get-Content $sig.FullName -Raw).Trim()
$pub = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$json = @"
{
  "version": "$Version",
  "notes": "$Notes",
  "pub_date": "$pub",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "https://zhivaya-skazka.ru/updates/operator-desktop/$($zip.Name)"
    }
  }
}
"@
$outJson = Join-Path $rel "latest.json"
Set-Content $outJson $json -Encoding utf8
Write-Host "`n=== latest.json готов: $outJson ===" -ForegroundColor Green
Write-Host "`nДеплой на сервер:" -ForegroundColor Cyan
Write-Host "scp `"$($zip.FullName)`" `"$($sig.FullName)`" `"$outJson`" root@5.129.241.152:/var/www/updates/operator-desktop/"
Write-Host "Проверка: curl `"https://zhivaya-skazka.ru/api/updater/check?current_version=5.1.5`""
```

- [ ] **Step 2: Проверить синтаксис скрипта (без сборки)**

Run: `powershell -NoProfile -Command "$null = [ScriptBlock]::Create((Get-Content -Raw C:\Users\Medya\Projects\operator-desktop\scripts\release.ps1)); 'syntax OK'"`
Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Medya\Projects\operator-desktop
git add scripts/release.ps1
git commit -m "chore(release): скрипт выпуска одной командой (bump+build+latest.json)"
```

---

## Task 4: Выпуск 5.1.6 (закоммитить → собрать → задеплоить → проверить плашку)

**Files:** все уже изменённые в рабочем дереве (`git status`: use-inbox*, notification.store, и т.д.) + версия.

- [ ] **Step 1: Просмотреть незакоммиченные правки 5.1.6**

Run: `cd C:\Users\Medya\Projects\operator-desktop && git status --short && git diff --stat`
Убедиться, что изменения — это 5.1.6 (re-join, авто-away, звук, .env.production удалён).

- [ ] **Step 2: Закоммитить 5.1.6-изменения**

```bash
cd C:\Users\Medya\Projects\operator-desktop
git add -A
git commit -m "feat: 5.1.6 — socket re-join, авто-away, звук нового чата; убран .env.production из трекинга"
```

- [ ] **Step 3: Собрать релиз скриптом**

Run:
```powershell
powershell -NoProfile -File C:\Users\Medya\Projects\operator-desktop\scripts\release.ps1 -Version 5.1.6 -Notes "Переподключение к сокету при разрыве, авто-away при простое, звук нового чата, мелкие фиксы"
```
Expected: сборка завершается, `releases/latest.json` создан, выводится команда `scp`.
Если падает на отсутствии `TAURI_SIGNING_PRIVATE_KEY` — остановиться и запросить у пользователя установку переменных окружения подписи.

- [ ] **Step 4: Закоммитить артефакты релиза**

```bash
cd C:\Users\Medya\Projects\operator-desktop
git add releases/
git commit -m "release v5.1.6"
git push origin main
```

- [ ] **Step 5: Бэкап latest.json на сервере и деплой**

```bash
ssh root@5.129.241.152 'cp /var/www/updates/operator-desktop/latest.json /var/www/updates/operator-desktop/latest.json.bak-5.1.5'
scp "C:\Users\Medya\Projects\operator-desktop\releases\Zhivaya-Skazka-Operator_5.1.6_x64-setup.nsis.zip" "C:\Users\Medya\Projects\operator-desktop\releases\Zhivaya-Skazka-Operator_5.1.6_x64-setup.nsis.zip.sig" "C:\Users\Medya\Projects\operator-desktop\releases\latest.json" root@5.129.241.152:/var/www/updates/operator-desktop/
```

- [ ] **Step 6: Проверить, что endpoint отдаёт 5.1.6 клиенту на 5.1.5**

```bash
ssh root@5.129.241.152 'curl -s "http://127.0.0.1:3010/api/updater/check?current_version=5.1.5" | head -c 200'
```
Expected: JSON с `"version":"5.1.6"`.

- [ ] **Step 7: Ручная проверка на запущенном клиенте**

Запустить установленный оператор (5.1.5) → в течение ~5с должна появиться плашка «🎉 Обновление v5.1.6». Нажать «Обновить» → загрузка → перезапуск → версия 5.1.6.

---

## Task 5: Аудит безопасности chat-api → отчёт findings

**Files:**
- Create: `C:\Users\Medya\Projects\operator-desktop\docs\superpowers\SECURITY-AUDIT-2026-06-07.md`

- [ ] **Step 1: Перечислить все роуты и наличие auth**

```bash
ssh root@5.129.241.152 'cd /opt/alphabet-chat-api/src/routes && for f in *.ts; do echo "### $f"; grep -nE "app\.(get|post|patch|put|delete)\(|preHandler" "$f"; echo; done' > C:\Users\Medya\Projects\operator-desktop\scratch\routes-audit.txt
```
Прочитать вывод; для каждого роута отметить: есть ли `preHandler: [authenticate]`, и должен ли быть.

- [ ] **Step 2: Зафиксировать findings в отчёте**

Создать `SECURITY-AUDIT-2026-06-07.md` со списком: каждый finding = {роут/файл, описание, severity (Critical/High/Medium/Low), рекомендация}. Заведомо известные:
- **High** — `PATCH /api/operators/:id/online` без auth: любой может менять онлайн-статус любого оператора. Нюанс: вероятно вызывается `sendBeacon` при закрытии вкладки (без заголовков) → нужен caller-aware фикс (Task 6).
- **Medium** — `/api/widget/*` без auth (by design): нет rate-limit и проверки владения сессией → визитор может писать в чужую сессию по угаданному UUID; нет лимита размера сообщения.
- Проверить: срок JWT (`auth.ts`), сила `JWT_SECRET` в `.env`, нет ли токена/секретов в логах, CORS-политика, утечки stack trace в ответах об ошибке.

- [ ] **Step 3: Commit отчёта**

```bash
cd C:\Users\Medya\Projects\operator-desktop
git add docs/superpowers/SECURITY-AUDIT-2026-06-07.md
git commit -m "docs(security): аудит chat-api — findings с severity"
```

---

## Task 6: Фикс High — `operators/:id/online` (caller-aware)

**Files:**
- Modify: `/opt/alphabet-chat-api/src/routes/operators.ts` (роут стр. 188)
- Проверить вызовы: `operator-desktop/src` (sendBeacon / online toggle)

- [ ] **Step 1: Найти всех вызывающих `/online`**

```bash
cd C:\Users\Medya\Projects\operator-desktop && grep -rn "operators/.*online\|/online\|sendBeacon" src/ | head
```
Определить: шлётся ли запрос через `sendBeacon` (без Authorization) или через обычный `api()` (с токеном).

- [ ] **Step 2: Выбрать стратегию по результату Step 1**

- Если ВСЕ вызовы идут через авторизованный `api()` (есть токен) → добавить `preHandler: [(app as any).authenticate]` к роуту (как у соседних роутов).
- Если есть `sendBeacon` без токена → НЕ ломать его: добавить мягкую защиту — принимать запрос только если в теле передан валидный `operator_id`, совпадающий с токеном (при наличии), а для beacon оставить узкий путь, ограниченный rate-limit и логированием. Конкретно: ввести отдельный роут `/api/operators/:id/offline-beacon` для закрытия вкладки (идемпотентный, только перевод в offline), а `:id/online` закрыть `authenticate`.

- [ ] **Step 3: Бэкап + правка на сервере**

```bash
ssh root@5.129.241.152 'cp /opt/alphabet-chat-api/src/routes/operators.ts /opt/alphabet-chat-api/src/routes/operators.ts.bak-20260607'
```
Внести выбранную в Step 2 правку.

- [ ] **Step 4: Рестарт + проверка**

```bash
ssh root@5.129.241.152 'systemctl restart alphabet-chat-api && sleep 2 && systemctl is-active alphabet-chat-api'
```
Проверить: авторизованный вызов работает; неавторизованный произвольный вызов отклоняется (401) — `curl` без токена на закрытый путь.

- [ ] **Step 5: Регрессия десктопа**

Если менялся клиент (новый beacon-путь) — собрать (`npm run build`), при необходимости включить в следующий релиз. Проверить, что онлайн/офлайн оператора переключается из приложения и при закрытии.

---

## Task 7: Фикс Medium — widget rate-limit + владение сессией

**Files:**
- Modify: `/opt/alphabet-chat-api/src/routes/widget.ts`

- [ ] **Step 1: Прочитать widget.ts — точки вставки сообщений и создания сессий.**

- [ ] **Step 2: Добавить лимит размера сообщения**

В обработчике `POST /api/widget/sessions/:id/messages` отклонять `message` длиннее, например, 4000 символов:
```ts
if (typeof message === "string" && message.length > 4000) {
  reply.code(413).send({ error: "Сообщение слишком длинное" });
  return;
}
```

- [ ] **Step 3: Лёгкий rate-limit для widget-эндпоинтов**

Внедрить in-memory лимит по ключу `visitor_id`/IP (например, не более N запросов/мин). Минимально — счётчик в `Map` с окном. Показать код хелпера и применить к POST-роутам виджета.

- [ ] **Step 4: Бэкап + правка + рестарт**

```bash
ssh root@5.129.241.152 'cp /opt/alphabet-chat-api/src/routes/widget.ts /opt/alphabet-chat-api/src/routes/widget.ts.bak-20260607 && systemctl restart alphabet-chat-api && sleep 2 && systemctl is-active alphabet-chat-api'
```

- [ ] **Step 5: Регрессия виджета**

Открыть сайт, проверить: чат работает, сообщения шлются, widget-бот «Ознакомиться с продукцией» и карточки/картинки работают, оператор берёт чат (поведение 2). Превышение лимита → мягкий отказ, без падения.

---

## Task 8: Гигиена + закрытие трека

- [ ] **Step 1: Зафиксировать в SECURITY-AUDIT, что `.env.production` содержал лишь публичный URL** (не секрет) → переписывание истории git не требуется; впредь покрыт `.gitignore` (`.env.*`).

- [ ] **Step 2: Проверить «664 рестарта» chat-api**

```bash
ssh root@5.129.241.152 'systemctl status alphabet-chat-api | head -20; journalctl -u alphabet-chat-api --since "24 hours ago" | grep -iE "restart|error|crash" | tail -30'
```
Если есть цикл рестартов — записать причину в отчёт и устранить (или вынести в бэклог отдельной задачей).

- [ ] **Step 3: Финальная регрессия всего**

Чат (оператор↔визитор), виджет на сайте, ВК-бот (тест VK-сценария + `journalctl alphabet-v3`), widget-бот, поведения 1–4 (трей, маршрутизация, разделение, presence). Никаких регрессий.

- [ ] **Step 4: Обновить статус задач/спеки, закрыть трек A.**

---

## Self-Review (проведено)

- **Покрытие спеки:** Блок 1 (апдейтер) → Tasks 1–4; Блок 2 (безопасность) → Tasks 5–7; Блок 3 (гигиена/выпуск) → Tasks 4, 8. ✓
- **Плейсхолдеры:** Task 5/6/7 содержат investigative-шаги, но с конкретными критериями выбора и кодом для каждой ветки — не «TODO». Rate-limit (Task 7.3) описан как «показать код хелпера» — при исполнении дать конкретный `Map`-лимитер. ✓
- **Согласованность типов:** `cmpSemver` сигнатура одинакова в node-тесте и в updater.ts; `checkForUpdatesManually` экспортируется из updater.tsx и импортируется в settings. ✓
- **Инварианты:** ВК/виджет/widget-бот/поведения 1–4 — регрессия проверяется в 6.5, 7.5, 8.3. ✓
