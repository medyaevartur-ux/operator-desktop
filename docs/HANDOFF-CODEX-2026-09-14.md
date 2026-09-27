# Хендовер Codex: Живая Сказка, оператор v8

> Исторический срез. Актуальный полный хендовер: [28.09.2026](HANDOFF-OPERATOR-2026-09-28.md). Старые отметки готовности ниже не заменяют новый срез.

## Нативные установщики собраны — 14.09.2026

Пользователь закрыл Edge и написал «го», разрешив возобновить Windows/Android упаковку. **Обе release-сборки успешно завершены**, без повторения ошибки 1455. Другие приложения не останавливались. Прежний запрет на сборку установщиков ниже относится к завершённому этапу 09:05 и снят этим решением.

Итоговая папка: `releases/8.0.0-beta.1/`; контрольные суммы и проверки — `artifact-manifest.json`.

| Артефакт | Размер | SHA256 |
|---|---|---|
| Windows x64 EXE | 9.74 MiB | `279bd92b1bb8b369ef3f74033d0bb9513a3844be512c63c2189333b01603342e` |
| Windows updater ZIP | см. manifest | `948186c78b4d84af926e25e7a9ab4aeefa9b7ee942393e71cad6a76363f954a1` |
| Android ARM64 APK | 19.89 MiB | `a3142403bdb05b4b83029188376641cf7d6d7c5bc3a484f79e7136b25f355849` |

- Windows: `Zhivaya-Skazka-Operator_8.0.0-beta.1_x64-setup.exe`; рядом `.exe.sig`, `.nsis.zip`, `.nsis.zip.sig`, `latest.json`. Cargo release завершился за 10m03s; NSIS завершён. Версия бинарника `8.0.0-beta.1`. ZIP содержит именно тот же EXE, SHA совпал. Подписи ZIP и EXE проверены **публичным ключом из tauri.conf** через установленный minisign-verify 0.2.5; изменённые байты отвергнуты. Проверка повторяет режим Tauri updater 2.10.0. Коммерческой Windows Authenticode-подписи нет (`NotSigned`); не путать её с отдельной подписью автообновления.
- Android: `operator-8.0.0-beta.1-arm64.apk`, рядом `android-latest.json`. Package `ru.zhivaya_skazka.operator`, versionCode **8000001**, minSdk24/targetSdk36, только ARM64, debuggable=false. `apksigner verify` и `zipalign -c -P 16 -v 4` прошли. Сертификат `f597838848896c60c23e1bb9f4df1e55b8286e7f0fd96d48f0969135d7b16b32` совпал с сохранённым прежним APK 4.0.0, проверенным перед сборкой. Ключ не менялся. SHA самого keystore `71c8e2bd3af1bebf2315996b596354bcb368dc2c0344aa0cebc290e1a15e749b`.
- Firebase Android-конфига совпал с разрешённым `zhivaya-skazka-operator`, package также совпал. Значения ключей/паролей не выводились.
- Gradle в этом проекте ограничен `org.gradle.workers.max=1`, parallel=false, Kotlin in-process. JVM heap остался 2 GB. Windows и Android собирались последовательно. Глобальные настройки/память Windows не менялись.
- `scripts/release.ps1` дополнен копированием `.exe.sig`; APK проверен и оформлен `scripts/prepare-android-update.ps1`. В native-папке есть README о требованиях API и статусе beta.
- Логи: `scratch/v8/windows-installer-build.log`, `windows-signature-verification.log`, `android-installer-build.log`, `android-zipalign.log`. Клиентские 22 регрессии и свежий frontend build снова прошли перед Windows; Android также собрал текущий frontend.
- Предупреждения без ошибок: deprecated API/Gradle и отсутствующие consumer-rules в зависимостях Tauri Android; в проекте minify выключен. Windows v1-compatible updater оставлен сознательно для существующих клиентов; Tauri предупреждает о будущей отмене этого формата в v3.

**Не выполнено:** автоматическая установка/запуск приложений, физические проверки на S22 (ADB устройств 0), публикация канала обновлений, переключение боевого API/виджета на v8. Эти сборки требуют v8 API: на прежнем backend полноценный вход не заработает. Нужен согласованный переход по RELEASE-V8.md, затем проверка реального тестового диалога и уведомлений. Нельзя объявлять source/build проверки доказательством работы на телефоне.

Ниже сохранён срез этапа подготовки сервера/web/виджета без установщиков; его неизменяемые архивы остаются действительными. Новые native-файлы лежат отдельно.

Актуальный срез: **14.09.2026, 09:05 Екатеринбург**. Этот документ заменяет промежуточные записи в нём. Входящий `HANDOFF-2026-09-operator-app-v8.md` сохранён отдельно, не редактировать. Репозиторий: `C:\Users\Medya\Projects\operator-desktop`; исходный HEAD `a7751c4`. Изменения не staged, не закоммичены, не отправлены в Git.

## Результат текущего этапа

**Подготовлен кандидат `8.0.0-beta.1` без установщиков.** Сервер, web/PWA, виджет и исходники Windows/Android реализованы, проверки ниже пройдены. Полная v8 не переключена на production; реальные Android/Windows уведомления и обновление поверх установленного приложения ещё не проверены на устройствах.

Готовый комплект:
`prepared-v8/8.0.0-beta.1-20260914T040023Z/`

- `chat-api.tgz` — SHA256 `cef6fa5debeeac1d239749cf11311a464a756f76675a034bd41528957ce45b4f`.
- `operator-web.tgz` — SHA256 `8e9c787c8379386acde3997dd20de68772b7940c028aaf6eb4149eeaccd78cb8`.
- v8 `widget.js` — `8864397194de76c6ce65357fe68aac0bd801c7f1d21c767ef1f0ab907969f3eb`.
- v8 `widget.min.js` — `2b4eb0dda76c003899c43e28b0922ae875562c18f8c58ae8a69c007933330593`.
- `release-manifest.json` — полный список файлов, SHA256, размеров; `native_installers_included=false`.
- `release_chat.py`, `rollback_chat.py`, `prepare_chat_env.py`, `RELEASE-V8.md`.

Исходники native находятся в `src-tauri/`; в архивы не включены ключи, .env, node_modules, данные клиентов и uploads. Путь к последнему комплекту — `prepared-v8/LATEST.txt`. [Инструкция выпуска](RELEASE-V8.md), [краткий README](../README.md).

## Решения пользователя и права

- Пользователь просил приложение по примеру Jivo, полное продолжение: «да, делай все!».
- Одобрил **тёплый фирменный стиль**; телефон **Samsung S22 Ultra**.
- После ошибок памяти 1455/Java: **«Пока подготовь всё без установщиков»**. Не возобновлять EXE/APK/AAB автоматически. Source checks допустимы и выполнены; они не установили приложение.
- Разрешены работы с чат-сервисом/виджетом на `5.129.241.152`, SSH и нужные исправления. Существующий SSH-ключ работает, новый не создавался.
- Явно разрешены Firebase **zhivaya-skazka-operator** и стандартный WebPush: наружу **только идентификаторы и общее «Новое сообщение»**. Полные данные — со своего API после авторизации. Не передавать имена, сообщения, ссылки страниц в push.
- Явно разрешил FCM privacy hotfix и перезапуск **только alphabet-chat-api** — выполнено.
- Явно разрешил весь тестовый кандидат в `/opt/alphabet-chat-api/.codex-v8-work` и тесты на **codex_chat_v8_test_20260914**. Предыдущий auto-review отказ о недостаточной явности передачи кандидата снят этим разрешением; повторно не спрашивать.
- Не писать настоящим посетителям ради тестов, не менять магазин/другие сайты, VPN, pagefile, чужие процессы. Не публиковать Git/стабильный канал без соответствующего решения. Дополнительные агенты не запускались.
- Исторический Android `release.keystore` уже tracked; пароли вынесены в игнорируемый `keystore.properties`. Ключ не менялся, из новых архивов исключён. Перед внешней передачей репозитория отдельно решить вопрос истории/подписи, не ломая обновления существующих установок.

## Что действительно работает в production

**Это ещё legacy API**, `/opt/alphabet-chat-api`, порт 3010, сервис `alphabet-chat-api`. Последний read-only срез: active, PID 2280024, NRestarts 0. `/api/widget/settings` и главная сайта отвечают 200. Строгая v8-авторизация ещё не защищает legacy-сокет — не выдавать готовность исходников за production-факт.

1. FCM privacy hotfix:
   - файл `/opt/alphabet-chat-api/src/services/push.ts`;
   - текущий SHA `758d0107abaeec2fcc30a2b1d14b48ab3a8ff7176c07a72f216a0d5f291889dd`;
   - исходный SHA `b638c07143dcd2c9715edcd89f8b7cfaba185555584ba59ff0ce58f56d8c36b5`;
   - backup `/var/backups/zhivaya-chat-codex/20260914-push-privacy/push.ts`;
   - текст/имя убраны из FCM, префиксы токенов из логов. Первый запуск автоматически откатился из-за неверной health-проверки `/config`; повтор с реальным `/api/widget/settings` завершился успешно.
2. Nginx `/api/push/` направлен на 3010:
   - файл `/etc/nginx/sites-enabled/zhivaya-skazka.ru`;
   - SHA `56da67d927c85e2054587e7c97f29b2f1fb6852b080584cb54b463a06a403495`;
   - backup `/var/backups/zhivaya-chat-codex/20260913T211747Z-push-routing/nginx.conf`;
   - магазинный `/api/upload` остался на 3000.
3. Виджет: ранее исправлены reconnect/retry; затем точечно исправлен host-transform, который уводил мобильное окно за верх экрана. Удалены две ошибочные custom-property декларации с составным CSS. До: окно top -717.59/bottom 0; после: top 62.41/bottom 780.
   - текущий live source SHA `a1ffc5c2a6c48fcad43e94f4abf45039905d7d55d5cbc649a5457b5acc779122`;
   - текущий live min SHA `52ca894229f86d98025614baab3cd93f37cbd9d6bf83fc4f3e203350b0675847`;
   - backup `/var/backups/zhivaya-chat-codex/20260914T010552Z-widget`;
   - отдельные legacy-файлы: `scratch/v8/widget-legacy-baseline.js`, `widget-legacy-layout-fix.js`, `widget-legacy-layout-fix.min.js`;
   - публичные байты проверялись с cachebuster. Старый кэш может жить час.
4. **Подготовлена**, но не используется legacy-сервисом, `/opt/alphabet-chat-api/.env.chat-v8`, права 0600: VAPID-ключи готовы, JWT и Firebase сохранены. Генерация не перезапускала сервис и не применяла миграции. Значения секретов не выгружались.

Срез digest live исходников (src + package/lock/tsconfig): `ed4dd3bca81d3f0bac0828f05762bc5d2b5bdd7bb7f8e00768c10a1c6e68df83`. Перед выпуском читать свежий план, не использовать старые SHA вслепую.

**Не выкладывать root widget.js/min на legacy API.** Это уже v8 SDK. `scripts/deploy-widget.ps1` теперь откажется до загрузки файлов, если source требует `/api/widget/identity`, а `/api/chat-v8/meta` не подтверждает v8.

## Что реализовано в кандидате

### API и данные

- `server/`: локальная полная копия API, Fastify, PostgreSQL. Исходный baseline SHA `75044992bb554d41c16f1211d3dda0e3da7a7ddb68b56ee060e33aa6d25b8426`, local `scratch/v8/baseline/source.tgz`, remote `/var/backups/zhivaya-chat-codex/20260914-v8-baseline/source.tgz`.
- БД **общая с Alphabet**. Миграции 001–004 только про чат. В тестовой БД применены; в production **не применены**. Runner сверяет checksum, держит advisory lock и повторно читает applied после захвата. Нельзя править уже применённые SQL.
- Access 20 минут, hashed refresh 30 дней, ротация с коротким grace, отзыв семьи, active roles, last-admin guard, привязка устройства и защита installation ID от захвата другим оператором. Web refresh — HttpOnly cookie; native refresh не возвращается JS.
- Сокеты оператора требуют JWT; посетителю выдаётся подписанный ID/token. Проверяется владение сессией, автор действий, роли, блокировка. Нет legacy fallback по одному visitor_id. Внутренние сообщения не попадают посетителю.
- Сообщения/файлы имеют стабильный client_message_id и транзакционную идемпотентность. История с cursor, microsecond-safe pagination и around-anchor; поиск с количеством и страницами. Вложения до 10 MB, magic-byte проверка, приватное хранение и истекающая capability-ссылка.
- Атомарные claim/transfer/capacity, передача с приватным комментарием, очередь/приоритет/закрытие/прочтение. Отключение сотрудника возвращает открытые обращения в очередь и отзывает сеансы.
- Shared templates с revision, import/use; контакты с optimistic revision; идемпотентная офлайн-заявка создаёт рабочий диалог.
- Посетители: фильтры/поиск/страницы, актуальная online-presence 120 секунд, путь, блокировка. Конкурирующие start-chat не создают дубли. Приглашения ограничены активными посетителями, дубль в течение 10 минут отклоняется; accept/decline перенесены на подписанный `/api/widget/invitations/:id/...`.
- Durable события/доставка, dedupe, SKIP LOCKED, ack/retry, DND/часовой пояс, catch-up, эскалация только ответственным. Внешний payload жёстко ограничен ID и общим текстом. Worker останавливается после in-flight работ.
- Статистика/журнал/устройства/сеансы/настройки связаны с реальными таблицами. Updater использует semver для beta→stable, собственные HTTPS URL и ограничение realpath; Android manifest с hash/size/code.

### Клиент и native

- Общие desktop/mobile экраны: диалоги, карточка, очередь, посетители, команда, шаблоны, настройки, статистика, конструктор, диагностика. Lazy screens; Monaco заменён textarea + sandbox preview.
- Тёплая тема, удобные мобильные раскладки, отдельные черновики ответа/заметки и файлов, быстрые ответы/переменные, форматирование, очередь отправки и явные retry/cancel. Просмотр чата не присваивает его оператору.
- Access только в памяти, central HTTPS API, сериализованный refresh, защита от запоздалых ответов после смены аккаунта. Общие настройки и сообщения не используют старый localStorage bearer.
- Поиск открывает сообщение даже в диалоге вне текущего списка; устаревший запрос не стирает новый результат. Открытие старого чата из push также запрашивает его по ID, не застревает в pending.
- Offline outbox сохраняется до отправки, stable IDs, учёт аккаунта, ограниченный cache. Failed native replies возвращаются в outbox.
- Windows: Credential Manager/DPAPI, COM activation, toast reply/read, защищённая очередь действий, badge/taskbar/tray/cold start, single-instance, штатные рамка и системные кнопки. Release AppID `ru.zhivaya-skazka.operator`; debug отдельный. Автозапуск на компьютере не включался, приложение не запускалось ради tests.
- Android: AndroidKeyStore AES-GCM, data-only FCM → WorkManager, fetch деталей с собственного API, reply/read, подтверждения, локальные защищённые ответы, account binding. Все async mobile IPC ожидаются без блокировки UI.
- Android updater: HTTPS, ограничение размера/времени, cancel, hash/package/certificate/versionCode и отдельный системный install. Подготовлен исходник, загрузка/установка обновления не выполнялись.
- Android `versionCode=8000001`; следующий опубликованный APK должен иметь больший code, даже если это stable той же semver. Пакет `ru.zhivaya_skazka.operator`, SDK 36/min 24.
- Web/PWA: app-shell cache без API, scoped service worker, общие push, auth/logout context, click→chat. **Отдельный HTTPS origin operator.zhivaya-skazka.ru ещё не размещён**, DNS/TLS/hosting не менялись.
- Конструктор не сохраняет значения по умолчанию при ошибке загрузки; preview sandbox не имеет same-origin/storage доступа. Мобильные размеры и принудительный desktop preview исправлены.

## Фактически выполненные проверки

- **22/22** клиентских reliability-теста; TypeScript + production Vite/widget build прошли. Основной chunk 713.28 kB / gzip 228.71 kB. Лог `scratch/v8/prepared-release.log`.
- **7/7** серверных policy-тестов, серверный TypeScript build.
- **25/25** интеграций на `codex_chat_v8_test_20260914`. Последний source test archive SHA `1eaa3ffd8aec695ef42e79fcd347a685705d8457fb41c06a10a9732109be53e2`; remote `.codex-v8-work/test.log`. Оригинальные 22 сценария дополнены приглашениями, start-chat и presence/pagination.
- **Сам финальный chat-api.tgz** отдельно распакован в `.codex-v8-work/verify-cef6fa5debeeac1d`; проверен SHA архива и 81 запись внутреннего manifest, `npm ci --omit=dev`. Скомпилированный `dist/app.js` на тестовой БД: health/meta 200, devices без JWT 401, версия beta.1. Production не переключался.
- Windows `cargo check --lib -j1` и **3/3 cargo test --lib** прошли, в том числе DPAPI/tamper, toast XML, origin confinement. Финальный лог `scratch/v8/windows-final-unit.log`.
- Android ARM64 Rust check прошёл: `scratch/v8/android-rust-final.log`. Kotlin `:app:compileArmDebugKotlin` прошёл: `scratch/v8/android-kotlin-final.log`. Есть предупреждения deprecated API в сгенерированном Tauri коде и о будущем Gradle 9, без ошибок. APK/AAB не строились.
- `npm audit`: **0 уязвимостей в клиенте и 0 в API**, срез 14.09.2026. Логи `scratch/v8/root-audit-final.json`, `server-audit-final.json`. Совместимые scoped overrides: gaxios6→uuid11 (использует v4), tsx→esbuild0.28.2.
- Все 8 desktop разделов + mobile диалог/настройки и 5 дополнительных mobile разделов пройдены в Chromium на fixtures. Нет JS pageerrors и горизонтального выхода за viewport. Sandbox preview header/window входят в viewport. Запросы к реальному сайту в этом браузере заблокированы. Это **не** доказательство реальной нативной доставки.
- Python/PowerShell ops-синтаксис проверен, nginx-план на реальном конфиге read-only: только 2 добавления и идемпотентность. Автоматический и ручной v8 rollback написаны, но production-cutover/rollback v8 не выполнялись.
- Workflow `.github/workflows/verify.yml` подготовлен с pinned actions, synthetic PostgreSQL и source-only Windows job. Не отправлялся в GitHub и не запускался там — CI не называть зелёным.

## Где смотреть интерфейс

Локальный Vite на `http://127.0.0.1:1420`, PID **21004**, запущен скрыто с `VITE_API_URL=https://zhivaya-skazka.ru`. Старый собственный preview PID3248/esbuild заменён после проверки владельца. Чужие процессы не останавливались.

Тестовый browser CLI session `operator-v8-final`, route fixtures блокируют production API/socket. Не считать эту вкладку реальным входом. Генератор fixtures: `scratch/v8/generate-ui-fixture.mjs`; действия: `mock-app-final.js`, `inspect-workspace.js`, `inspect-mobile.js`, `inspect-mobile-workspace.js`, `inspect-widget.js`.

Финальные изображения (вымышленные данные):
- `output/playwright/operator-v8-application.png` — реальный desktop интерфейс;
- `operator-v8-android-conversation.png`, `operator-v8-android-settings.png`;
- `operator-v8-widget-current.png`;
- `operator-v8-{visitors,templates,team,settings,queue,dashboard,widget-settings,diagnostics}.png`;
- mobile дополнительные `operator-v8-android-{visitors,queue,team,dashboard,widget-settings}.png`.

Макет направления отдельно: `/docs/design/v8.html`. Он не является приложением, не содержит ключей и не отправляет запросы.

## Что осталось после этапа «без установщиков»

1. Когда пользователь возобновит упаковку: Windows EXE/update signature и Android ARM64 APK с прежним сертификатом, версии/code. Не строить их автоматически из этого хендовера.
2. Реальная приёмка на S22 Ultra и Windows: вход/выход/смена аккаунта, фон/сон/перезагрузка, потеря сети, toast reply/read/open, DND, неотправленные ответы, tray/autostart, обновление поверх установленного приложения. Сейчас код/компиляция подтверждены, устройство — нет.
3. Подготовить размещение web/PWA, если этот канал нужен при выпуске; HTTPS origin предусмотрен, не опубликован.
4. Согласованно перейти с legacy на v8: готовые операторские клиенты, версия загрузчика виджета и cachebuster, свежие SHA/backup, migrations/release, затем реальный тестовый диалог. Не закрывать legacy протокол до готовности клиентов. Полная v8-выкладка намеренно отложена вместе с нативными пакетами.
5. При новых исходниках пересоздать комплект и повторить **затронутые** проверки; текущий проверенный архив не изменять задним числом. Не расширять проверки без новой причины.

Полная инструкция и команды находятся в `docs/RELEASE-V8.md`. Следовать `AGENTS.md` и новым решениям пользователя; не восстанавливать устаревшие TODO из прежней версии этого документа.
