# Живая Сказка — Operator Desktop & Widget. План полной переработки на 2026

> Цель: превратить текущий «панель оператора + виджет» в продукт уровня Jivo/Intercom/Crisp 2026 года, но с собственным сказочным визуальным языком (тёплая палитра + cloud.anthropic-style глассморфизм, мягкие тени, плавные пружинные анимации, типографика как на лендинге «Живая Сказка»). Десктоп должен ощущаться как настоящее нативное Windows-приложение: трей, badge, push-уведомления через WinRT, бесшумные авто-обновления, оффлайн-режим, мгновенный отклик.

Документ — **актуальный план** (v2 после правок от 2026-05-19). Я всегда сверяюсь с ним перед работой и обновляю по ходу.

---

## 0. TL;DR — что мы получаем на выходе

1. **Operator Desktop 5.0** — переработанный UI в духе тёплой/сказочной стилистики лендинга «Живая Сказка» (золото + кремовый пергамент + glass-морфизм), три темы (light / dark / fairytale + сезонные), кастомизация стилей **внутри самого приложения** (оператор может крутить акцент, плотность, шрифт), нативные WinRT-уведомления с inline-reply, бейдж + динамический tray-icon с цифрой, ПКМ по трею → «Свернуть / Закрыть полностью / Открыть», корректные обновления.
2. **Widget 6.0** — тот же визуальный язык. Артефакт остаётся **один файл `widget.js`**, как сейчас (просто исходник в `widget-src/` для разработки, на выходе один минифицированный бандл, копируется на сервер как раньше). Никаких плееров сказок внутри виджета. Фокус: красивая стилистика лендинга, привлекательные триггеры/инвайты, gold/cream glass FAB, тосты, гостевой email при оффлайне, нулевые утечки.
3. **Чистая архитектура** — code-split по фичам, единый design-tokens файл, удалены дубли, починены утечки, добавлены error boundaries, типобезопасные API-обёртки.
4. **Свой SVG-логотип** «Живая Сказка» — иконка приложения (ico + 16/32/48/128/256/512), favicon, tray-icon (моно + цветной).
5. **Гибкие сценарии** — конструктор триггеров (триггеры виджета сейчас в коде, выносим в UI с условиями: страница / время на сайте / scroll / exit-intent / utm / повторный визит). A/B-тестирование вариантов виджета.
6. **Превью виджета вживую** в настройках — справа меняешь, слева real-time iframe-превью с эмуляцией размеров (mobile/tablet/desktop).
7. **Шаблоны ответов** — CRUD с папками, переменными `{{name}}`, шорткатами `/привет`.
8. **Статистика красиво** — KPI-плитки с rolling-counter, графики, воронка, heatmap, карточка профиля посетителя с lead-score и путём по страницам. **Без карты мира** (это не из «корина», просто не нужно).

---

## 1. Аудит текущего состояния (что есть)

### 1.1 Frontend (React 19 + Vite 7 + Tauri 2)
| Слой | Файл | Строк | Состояние |
|---|---|---|---|
| Shell | [src/components/layout/app-shell.tsx](src/components/layout/app-shell.tsx) | 175 | Хороший каркас, но логика мобайл/десктоп ветвится в рантайме без переключения внутри одной сессии |
| Sidebar | [src/components/layout/chat-sidebar.tsx](src/components/layout/chat-sidebar.tsx) | 241 | OK |
| Main | [src/components/layout/chat-main.tsx](src/components/layout/chat-main.tsx) | 617 | Слишком толстый: лента, header, шаблоны, поиск, ответы — всё в одном файле |
| Composer | [src/components/layout/chat-composer.tsx](src/components/layout/chat-composer.tsx) | 594 | Толстый, эмодзи/аттач/шаблоны в одном компоненте |
| Details | [src/components/layout/chat-details.tsx](src/components/layout/chat-details.tsx) | 657 | Толстый, надо бить на секции |
| Visitors | [src/components/screens/visitors-screen.tsx](src/components/screens/visitors-screen.tsx) | 688 | Толстый |
| Widget Settings | [src/components/screens/widget-settings-screen.tsx](src/components/screens/widget-settings-screen.tsx) | 1285 | **Критично разросся**, обязательная декомпозиция |
| Inbox store | [src/store/inbox.store.ts](src/store/inbox.store.ts) | 519 | Слишком много обязанностей в одном сторе |
| Notifications store | [src/store/notification.store.ts](src/store/notification.store.ts) | 281 | Хороший, но требуется выделить аудио-движок |
| Widget | [widget.js](widget.js) | 2313 | **Один файл, IIFE**, нет модулей, нет тестов, ручной рендер innerHTML, есть мелкие утечки |

### 1.2 Tauri (Rust)
[src-tauri/src/lib.rs](src-tauri/src/lib.rs) — 178 строк. Реализованы: tray-icon, set_badge_count (через tooltip + title), close-to-tray, notify_offline. **Не хватает**: глобальные шорткаты, single-instance, autostart, нативные тосты с действиями, deep-link, шифрованное хранилище токена, dock-bounce для macOS.

### 1.3 Известные/потенциальные проблемы кода

#### Утечки и баги (обнаружены при чтении)

1. **[widget.js:1822-1844](widget.js:1822)** — `setupSessionHandlers` создаёт два setInterval (`visitorPingTimer`, `pageCheckTimer`), но если socket переподключается (`io.reconnection: true` по умолчанию), функция-обработчик `connect` повесит новые таймеры, а старые `setInterval` очистятся только в `disconnect`. Между двумя `connect` без `disconnect` (например, transport upgrade) получаем удвоение. ⇒ Каждый ping/check будет идти по 2-3 раза.

2. **[widget.js:1928-1935](widget.js:1928)** — глобальный `setInterval(..., 2000)` для SPA-page-tracking создаётся вне `setupSessionHandlers`, никогда не очищается. На SPA-сайтах будет накапливаться при HMR или повторном вызове `init` (если виджет переподключается).

3. **[widget.js:1913-1926](widget.js:1913)** — `visibilitychange` listener вешается через `document.addEventListener`, при повторной инициализации виджета (а это возможно при кэшировании script-тегов) — двойная подписка.

4. **[src/features/inbox/use-inbox.ts:30-32](src/features/inbox/use-inbox.ts:30)** — useEffect с пустым `[]`, читает `useAuthStore.getState().operator` **один раз при маунте**. Если оператор поменялся (logout → login другим юзером без перезапуска), heartbeat останется на старом ID. Нужно подписаться на изменение operator.id.

5. **[src/features/inbox/use-inbox-realtime.ts:154-166](src/features/inbox/use-inbox-realtime.ts:154)** — `socket.on("operator_requested", ...)` подписывается без сохранения handler-функции в переменной, а в cleanup делается `socket.off("operator_requested")` без аргумента — отвяжет ВСЕ обработчики этого события, включая чужие. Сейчас не критично (других нет), но при добавлении компонента-«сторонника» произойдёт незаметный баг.

6. **[src/lib/notifications.ts](src/lib/notifications.ts)** — этот файл существует **параллельно** с [src/store/notification.store.ts](src/store/notification.store.ts), и оба умеют играть звуки и показывать desktop-notifications. Дублирующая логика, путаница, разные громкости/семплы. Один из них — мёртвый код (звать его уже почти нечем, но если зовётся — будут два разных beep'а).

7. **[src/lib/socket.ts:23-66](src/lib/socket.ts:23)** — модульная синглтон-переменная `socket`. После `disconnectSocket()` пересоздание идёт нормально, но если несколько компонентов одновременно вызовут `getSocket()` до первого `connect`, события connect/disconnect развешиваются ровно один раз — это ок. Однако **socket подключается без передачи operator-токена** — сервер не знает, что это за оператор, и broadcast'ы летят всем. Если на сервере уже есть room-based isolation — fine, иначе утечка чувствительных данных между операторами.

8. **[src-tauri/src/lib.rs:151-171](src-tauri/src/lib.rs:151)** — `on_window_event` для CloseRequested. Когда close-to-tray=false, эмитится `app-closing`, но окно **не закрывается** автоматически — `prevent_close` не вызывается, значит дефолт = закрыть. Однако фронт ждёт события и шлёт offline через `notify_offline`, который запускается в отдельном потоке без `join` — поток может не успеть отправить HTTP до завершения процесса. ⇒ Иногда оператор остаётся «online» после закрытия.

9. **[widget.js:538](widget.js:538)** — `shadow.innerHTML = ""` каждый рендер. Это уничтожает все listeners на DOM. На `scheduleRender()` (60fps) — приемлемо, но при большом числе сообщений (200+) полный re-render заметно лагает на слабых машинах. Уже есть инкрементальные refs, но они почти не используются — почти всё идёт через полный render.

10. **CSP отключён** — `tauri.conf.json: "csp": null`. Для продакшна нужно настоящий CSP, иначе любая XSS в имени посетителя/сообщении даст RCE через Tauri-инвоки.

11. **[src-tauri/tauri.conf.json:15](src-tauri/tauri.conf.json:15)** — `"title": "Zhivaya Skazka � Operator"` — мусорный символ (битый em-dash). На Windows в заголовке окна и в taskbar будет квадратик.

12. **`max_concurrent_chats`, `current_chats_count`** в БД есть, но в UI нет ни лимита, ни визуала перегруза.

13. **JWT в localStorage** — уязвимо к XSS. Для desktop нужно перенести в Tauri stronghold/secure-store.

14. **Нет error boundaries** — одна ошибка в `ChatDetails` гасит весь экран.

15. **Нет offline-режима** — если интернет пропал, UI замораживается, оптимистичных апдейтов нет.

16. **i18n** — везде русский хардкод. Если будете расширяться — больно.

17. **Бэкап локального черновика сообщения** — composer не сохраняет недописанный текст между переключениями чатов. Каждый раз — пустое поле.

18. **Tauri-updater** падает на нестабильном интернете без user-feedback (компонент [updater.tsx](src/components/updater.tsx) показывает прогресс, но не ретраит).

19. **NSIS-installer без user-mode**: `installMode: "both"` — даёт выбор, но требует UAC. Для удобства операторов хотим тихий per-user install.

20. **Иконка приложения — placeholder**. SVG логотипа «Живая Сказка» нет.

---

## 2. Целевая архитектура

### 2.1 Структура папок (новая)

```
src/
├── app/                         # entry, routing, providers
│   ├── app.tsx
│   ├── app-router.tsx
│   ├── providers/               # Query, Theme, ErrorBoundary, ToastHost
│   └── command-palette/         # ⌘K / Ctrl+K
├── design-system/               # 🆕 единый источник стилей
│   ├── tokens.css               # CSS-переменные (light/dark/fairytale)
│   ├── typography.css
│   ├── primitives/              # Button, Input, Dialog, Toast, Tooltip…
│   └── icons/                   # SVG-сет (живая сказка)
├── features/
│   ├── auth/
│   ├── inbox/                   # only chat business-logic
│   ├── operators/
│   ├── visitors/
│   ├── widget-settings/         # большая фича — отдельная папка
│   ├── analytics/               # 🆕 дашборд
│   ├── canned-replies/          # 🆕 шаблоны = редактируемая фича
│   ├── command-palette/
│   └── notifications/           # 🆕 storage + WinRT toast bridge
├── modules/                     # переиспользуемые куски
│   ├── chat/                    # MessageList, MessageBubble, Composer
│   ├── presence/                # OnlineDot, TypingIndicator
│   └── files/                   # uploader, thumb
├── lib/
│   ├── api.ts
│   ├── socket.ts                # с операторским токеном при handshake
│   ├── tauri-bridge.ts
│   ├── secure-store.ts          # 🆕 stronghold/credential-manager
│   ├── platform.ts
│   └── logger.ts
├── store/                       # zustand сторы, разбиты по доменам
│   ├── auth.store.ts
│   ├── sessions.store.ts        # бывший inbox.store, split
│   ├── messages.store.ts
│   ├── ui.store.ts              # темы, layout, sidebar collapsed
│   ├── notifications.store.ts
│   └── drafts.store.ts          # 🆕 черновики per-session
└── widgets/                     # legacy widget.js будет переписан как ES-модули → бандл

widget-src/                      # 🆕 исходники виджета
├── core/                        # state, scheduler, api, socket
├── ui/                          # render fn, components
├── modules/                     # triggers, business-hours, auto-msg, A/B
├── styles/                      # CSS-modules
├── index.ts
└── build.ts                     # rollup → /var/www/widget/widget.js
```

### 2.2 Принципы
- **Один source of truth для дизайна** — `design-system/tokens.css` + Radix-primitives. Никаких inline-стилей в фичах.
- **Тонкие компоненты** — ни один файл > 300 строк. ChatMain → MessagesList + ChatHeader + MessageItem + EmptyState.
- **Сторы — узкие** — каждый отвечает за одну сущность; перекрёстные обновления через события / селекторы.
- **Сетевой слой — React Query** — кэш, оптимистичные апдейты, ретраи. Сокеты — только триггер invalidate.
- **Все хоткеи** — через единый registry с конфликт-детектом и подсказками в command-palette.

---

## 3. Дизайн-язык «Сказочный Cloud»

### 3.1 Палитра (CSS-токены)

```
--brand-amber:        #d97706    /* основной — золото книжных страниц */
--brand-amber-soft:   #fbbf24
--brand-cream:        #fef3c7    /* фон страниц */
--brand-ink:          #1c1917    /* текст */
--brand-mist:         #fafaf9
--brand-violet:       #7c3aed    /* акцент для интерактива */
--brand-rose:         #fb7185    /* акцент 2, реакции */
--brand-sage:         #65a30d    /* online */
--brand-amber-glow:   radial-gradient(circle at 30% 20%, #fde68a, transparent 70%)

/* dark */
--ink-bg-1:           #0c0a09
--ink-bg-2:           #1c1917
--ink-elev-1:         #292524
--ink-text:           #fafaf9

/* fairytale (опционально, как theme=fairytale) */
--ft-bg:              linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)
--ft-overlay:         url("/textures/parchment.webp") /* пергамент */
--ft-shadow:          0 24px 64px -16px rgba(217, 119, 6, 0.25)
```

### 3.2 Глассморфизм (cloud-style)
- Поверхность диалогов / details / overlays: `backdrop-filter: blur(24px) saturate(140%)` + полупрозрачная заливка + 1px hairline border `rgba(255,255,255,0.6)`.
- Тень: двухслойная (`0 1px 2px rgba(0,0,0,.04), 0 24px 48px -12px rgba(217,119,6,.18)`).

### 3.3 Типографика
- Дисплей: **Onest** (бесплатно, кириллица, очень близка к cloud.anthropic) — для заголовков.
- Текст: **Inter Variable** (system fallback).
- Декоративный сказочный шрифт: **Tan-Mon-Cheri / Marquee Moon** — только для splash-screen и пасхалок, не для UI.

### 3.4 Иконки
Сменить lucide на собственный SVG-сет, единый стиль 1.5px stroke + closed-shape filled-variants. Базис — lucide, оверрайдим только: logo, settings, send, attach.

### 3.5 Анимации
- Все переходы — `cubic-bezier(.16, 1, .3, 1)` (как сейчас), но добавить framer-motion spring presets (`stiffness: 220, damping: 26`) для появления панелей, тостов, бейджа.
- Микро-фидбэк: при отправке сообщения — confetti из крошечных звёздочек (раз в N сообщений, чтобы не приедалось).

---

## 4. Экраны и компоненты Operator Desktop

### 4.1 Глобальный layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ▍ ⌘K  Команда поиска       [● online ▾]  [🔔 3]  [Артур ▾]    │  ← top-bar (новый), 44px, glass
├──────┬──────────────────┬───────────────────────┬───────────────┤
│  ▮▮  │ Inbox     [+]    │  Чат с Анной          │  Профиль клиента │
│  Rail│ ┌──────────────┐ │ ┌───────────────────┐ │  [фото, имя]   │
│ 64px │ │ Фильтры      │ │ │ Кошик Лебедя      │ │  email/phone   │
│      │ │ Все Мои AI   │ │ │ ........          │ │  страница      │
│      │ └──────────────┘ │ │ Лента сообщений   │ │  utm           │
│      │ Поиск 🔍         │ │                   │ │  Теги ◯◯◯      │
│      │ ────────────────│ │                   │ │  Заметки ✎     │
│      │ ● Анна  12:34   │ │ ┌───────────────┐ │ │  История ↓     │
│      │   Привет, нужна │ │ │ Composer      │ │ │  Действия      │
│      │ ● Иван  12:30   │ │ └───────────────┘ │ │                │
│      │                 │ │                   │ │                │
└──────┴─────────────────┴───────────────────────┴────────────────┘
```

#### Изменения vs текущий:
1. **Top-bar 44px** (сейчас нет) — содержит: командная строка ⌘K, статус сети WS, статус оператора, колокольчик уведомлений, аватар → меню (профиль/тема/выйти).
2. **Rail** остаётся 64px, но иконки в стиле «сказка», бейджи на каждом разделе, активный = золотая подсветка с лёгким parchment-bg.
3. **Sidebar 360px**, расширяемый до 480 (resize-handle, как в VS Code), сохраняется в `ui.store`.
4. **ChatMain** — flex со sticky header + sticky composer + центрированной лентой. Лента max-width 760px (читаемо).
5. **Details** — drawer 360–480, кнопка свернуть → 0, кнопка expand → fullscreen с табами (Профиль / История / Файлы / Аналитика).

### 4.2 Список диалогов (Sidebar)

Что добавить:
- **Сегменты** (вкладки): Активные / Очередь / Закрытые. Сейчас всё в одном списке.
- **Sticky-секции**: «🔥 Срочные» (без ответа > 1 мин), «⏰ Ждут оператора», «👤 Мои», «🤖 У бота».
- **Контекстное меню** на ПКМ: Назначить себе / Передать… / Закрыть / Архив / Скопировать ID.
- **Pinning**: возможность закрепить 1-3 чата (drag&drop).
- **Bulk-select** — Shift+click, операции массово (Закрыть, Назначить).
- **Превью с typing-индикатором** — уже есть в [typing-preview.tsx](src/components/layout/typing-preview.tsx), но он почти не выделяется. Сделать жирно курсивом с пульсирующим dot.

### 4.3 Лента сообщений (ChatMain)

Что добавить:
- **Группировка** по отправителю и времени (gap > 3 мин → новый блок), как iMessage.
- **Inline-ответы (reply)** — есть в `setReplyTo`, но визуал бледный. Сделать как Telegram: цветная вертикальная полоса слева от bubble + цитата.
- **Реакции эмодзи** — каркас уже есть на сервере (`reaction_updated`), нужно UI: hover-bar над сообщением → 👍❤️🎉✨💫.
- **Прикрепление файла** — drag&drop по всему экрану, preview перед отправкой, прогресс upload.
- **Голосовые** — запись с voice-message UI, waveform, отправка как audio attachment.
- **Системные «карточки»**: «Чат назначен на Артура», «Тег «оплата» добавлен» — компактные badge-полоски, цвет parchment.
- **Подсветка цитат из поиска** — при переходе из глобального поиска подсветить сообщение мягкой пульсацией 1.5 сек.
- **Виртуализация ленты** — `@tanstack/react-virtual` при > 100 сообщений. Сейчас рендерим всё, на длинных диалогах будет тормозить.
- **Кнопка «↓ внизу»** появляется когда юзер прокрутил вверх, с бейджем «3 новых».

### 4.4 Composer

Сейчас [chat-composer.tsx](src/components/layout/chat-composer.tsx) — 594 строки, табы Чат/Email/SMS/Комментарий, шаблоны, эмодзи.

Что улучшить:
- Разбить на: ComposerRoot / TabBar / TextInput / Toolbar / TemplatePicker / EmojiPicker / AttachmentTray / SendButton.
- **Markdown-preview** — toggle, рендер на лету.
- **Mentions @оператор** — для внутренних комментариев.
- **Slash-команды** `/close /assign @ivan /tag оплата` — выпадашка как в Discord.
- **Smart-replies (AI)** — кнопка «✨ Предложить ответ» (если бэк подключим к Claude/GPT). Не обязательно сейчас.
- **Черновики** — `drafts.store`, ключ session_id → text, сохраняется в localStorage с debounce 500 мс.
- **Hotkey reminder bar** — мелким сверху: «Enter — отправить, Shift+Enter — перенос, / — команда».

### 4.5 Details (правая панель)

Сейчас 657 строк — рефактор на табы:
- **Профиль** — имя, email, телефон, аватар (если есть), UTM, страница, устройство, браузер, IP, география.
- **Сессия** — статус, оператор, тайминги, теги (Combobox-добавление), действия (передать, закрыть, переоткрыть).
- **История** — компонент [session-history.tsx](src/components/layout/session-history.tsx) уже есть, докрутить: timeline-стиль, click → открыть закрытую сессию.
- **Заметки** — markdown, упоминания, дата автора, edit-inline.
- **Файлы** — все вложения сессии, grid превью, ZIP-скачать.
- **Аналитика клиента** — кол-во визитов, среднее время, оценки.

### 4.6 Новые экраны

> **Отказались:** «Дашборд» и «Аналитика» как отдельные экраны — не нужны.
> Статистика встроится в экран «Посетители» как сцены (см. раздел 10.5).

| Экран | Назначение |
|---|---|
| **Шаблоны ответов** ✅ | Сейчас захардкожены в коде — выделить в CRUD с папками, шорткатами, переменными `{{name}}`, `{{operator}}`, `{{date}}`. Поиск, избранное, drag-сортировка. |
| **Виджет** ✅ | Расширение текущего widget-settings: **live-превью** справа (iframe эмулирующий desktop/tablet/mobile), **A/B тесты** (два варианта виджета, ротация 50/50, метрики конверсии), история изменений. |
| **Сценарии (proactive)** ✅ | UI-конструктор триггеров: визуальная сборка условий «если URL содержит /pricing **И** время на сайте > 30 с **И** не был в чате последние 24 ч → показать инвайт `cfg_invite_1`». Сейчас всё захардкожено в widget.js. |
| ~~Дашборд~~ | ❌ Не делаем. |
| ~~Аналитика~~ | ❌ Не делаем. |
| ~~Бот / AI~~ | ❌ Не в первой версии. |

### 4.7 Command Palette ⌘K / Ctrl+K

- Поиск по чатам (имя, email, текст).
- Команды: «Закрыть чат», «Сменить статус», «Открыть настройки», «Перейти к оператору».
- Recent / suggested.
- Реализация: `cmdk` (Radix) + fuzzy-search через `fuse.js`.

---

## 5. Уведомления Windows (правильный путь)

Это болевая точка. Сейчас [src/lib/notifications.ts](src/lib/notifications.ts) + [src/store/notification.store.ts](src/store/notification.store.ts) дублируются, используют web Notification API из webview.

### 5.1 Целевая схема

```
chat-api  ──── new_message ───►  Tauri-app
                                    │
                                    ▼
                             notifications.store
                                    │
                       ┌────────────┼────────────┐
                       ▼            ▼            ▼
                   Toast UI     Tauri WinRT    Tray badge
                  (in-window)   (вне окна)    (taskbar)
```

### 5.2 WinRT-уведомления с действиями

`@tauri-apps/plugin-notification` v2.3 поддерживает **action buttons** (через `Channel` API) и **inline reply** (через `replyButtonTitle`, `actionTypeId`).

Что делаем:
1. Регистрируем уведомления заранее (PowerShell + AUMID = `ru.zhivaya-skazka.operator`) — нужно при инсталяции.
2. Шаблон:
   - title: «Анна — Живая Сказка»
   - body: «Привет, помогите оформить заказ»
   - icon: аватар клиента (lazy-load на disk-cache → передать в notif)
   - кнопки: **«Ответить»** (inline-text), **«Открыть»**, **«Закрыть чат»**
   - tag: `chat-{sessionId}` (стек уведомлений из одного чата → один toast)
   - sound: silent (звук играем сами через WebAudio, чтобы соблюсти DND и громкость из настроек)
3. Клик / Reply / Close — события через listen(`notification-action`) → бридж в фронт → инлайн-ответ POST'ит сообщение, открытие фокусит окно + setActiveSession.

### 5.3 Бейдж + tray

- В Windows нет нативного icon-overlay для обычных apps (только UWP). Поэтому: tray-tooltip `Живая Сказка — 3 непрочитанных`, **меняющаяся tray-иконка** с цифрой (генерируется на лету Rust + image crate, кеш по числам 0..99+).
- Также: тон-цвет иконки = красный, если есть mention.

### 5.4 In-window toasts

Свои `Sonner`/`react-hot-toast`-стиля тосты в правом нижнем углу (но не за экраном — внутри окна), для случаев когда окно открыто и не нужно дублировать system-toast. Решение: если `document.hasFocus()` → in-window toast, иначе → WinRT.

### 5.5 DND

Уже есть schedule. Добавить:
- **«Не беспокоить пока в чате»** — если есть `activeSession` и юзер печатает → подавлять звуки.
- **Quiet hours по выходным** — отдельный график.
- **Mute per-chat** — иконка-колокольчик в header чата.

---

## 6. Виджет 6.0 — план переработки

### 6.1 Проблемы текущего widget.js
- Монолит 2313 строк, sourcemap нет, трудно дебажить.
- `shadow.innerHTML = ""` каждый рендер → перформанс на длинных диалогах.
- Утечки таймеров (см. п.1.3).
- Без сборки — нет минификации, gzip ~50 КБ; можно урезать до 25–30.

### 6.2 Артефакт остаётся ОДНИМ файлом ⚠️ важно

На выходе у нас **один `widget.js`** — копируется в `/var/www/widget/widget.js` как раньше. Никакой разницы для сайта. Раздробление — это **только организация исходников** в `widget-src/` для удобства разработки:

```
widget-src/             ← исходники (вы редактируете тут)
  core/
    state.ts
    api.ts
    socket.ts
    scheduler.ts
  ui/
    render.ts
    header.ts
    messages.ts
    composer.ts
    prechat.ts
    rating.ts
  modules/
    triggers.ts
    business-hours.ts
    auto-messages.ts
    ab-test.ts
  styles/
    themes.ts
    base.css
  index.ts
            │
            │  npm run build:widget   (Rollup → один файл)
            ▼
dist/widget.js          ← деплой (cp на сервер)
```

Для тебя процесс: `npm run build:widget` → `cp dist/widget.js /var/www/widget/widget.js`. Всё, виджет на сайте обновлён.

### 6.3 Что делаем
1. **Rollup-сборка** в один минифицированный `widget.js` (~30 КБ gzip).
2. **Диффовый рендер** через крошечный VDOM (или просто грамотный incremental update без `innerHTML = ""`). Уберёт мерцания и утечки listener'ов.
3. **Cleanup**-функция `destroy()` — снимает все таймеры, listeners, socket. Экспортируем как `window.ZhivayaSkazka.destroy()`.
4. **API-обёртка** с retry + offline-очередью отправки.
5. **Темы / шрифты / градиенты** — оставляем функционал, выносим в `widget-src/styles/themes.ts`.
6. **Сказочный визуал по умолчанию**: header — золотисто-кремовый градиент как на лендинге, FAB — мягкое gold-сияние с пульсом, аватар оператора в рамочке-«медальон», fonts по умолчанию = Onest. Стилистика берётся ровно с landing-страницы «Живая Сказка».
7. **Адаптив**: мобайл — fullscreen sheet, планшет — bottom-sheet 90%, десктоп — pop-up 380x640.
8. **A11y**: focus-trap, aria-live для новых сообщений, prefers-reduced-motion.

### 6.4 Новые фичи виджета (только то что нужно)
- ✅ **Гостевой email-форма** в оффлайне с подтверждением через 2-шаговый wizard.
- ✅ **Тосты** внутри виджета «Оператор подключился», «Чат закрыт», «Файл загружен» — slide-down 2 сек, золотисто-кремовый стиль.
- ✅ **Тише/громче** звука уведомлений внутри виджета (toggle уже есть, оставить).
- ✅ **Привлекательные триггеры/инвайты** (главная цель!): proactive invitation с аватаром оператора, мягкой анимацией появления, понятным «принять/отклонить». Конструктор условий — в десктоп-приложении (Фаза 6).
- ❌ **Сохранение в PDF** — не нужно.
- ❌ **Обратный звонок** — не нужно.
- ❌ **Плеер сказок** — не нужно (это для лендинга, не для чата).
- ❌ **Прогресс ответа оператора** (typing-content live preview) — не нужно.
- ❌ **Карусель быстрых ответов** — не нужно (quick_replies остаются как есть, без скролла).

### 6.5 Безопасность виджета
- Удалить наивный `sanitizeCSS` → строгая фильтрация CSS-in-JS только в Shadow DOM.
- CSP-friendly: вынести inline-event handlers в `addEventListener` (сейчас местами `onclick = `).
- Не доверять `cfg.custom_font_url` без allowlist.
- `textContent` вместо `innerHTML` для всего пользовательского контента.

---

## 7. Tauri / нативная часть

### 7.1 Окно
- Прозрачный титлбар (`decorations: false` + кастомный titlebar в React) — Cloud-style.
- Acrylic / Mica на Windows 11 (`tauri-plugin-window-state` + Mica через `windows-rs`).
- Auto-save размер/позицию.

### 7.2 Single instance + Deep-link
- Плагин `tauri-plugin-single-instance` — клик по уведомлению при закрытом окне открывает существующий процесс.
- `tauri-plugin-deep-link` — `zhivaya-skazka://chat/{sessionId}` для интеграций.

### 7.3 Autostart
- `tauri-plugin-autostart` — toggle в настройках «Запускать при входе в Windows», галка по умолчанию.

### 7.4 Глобальные хоткеи
- `tauri-plugin-global-shortcut` — `Ctrl+Shift+Z` показать/скрыть окно, `Ctrl+Shift+M` mute.

### 7.5 Stronghold для секрета
- `tauri-plugin-stronghold` — JWT хранить тут, не в localStorage.

### 7.6 Логирование
- `tauri-plugin-log` — ротация, для send-feedback кнопки (с автоприложением последних 200 строк).

### 7.7 Обновления
- **Дельта-обновления** через `tauri-plugin-updater` — уже есть, но добавить:
  - Сначала проверять при старте, потом раз в час.
  - Тост «Доступна версия 5.1» с действиями «Обновить» / «Позже».
  - Скрытая авто-загрузка в фоне на metered=false.
  - Перезапуск только когда нет активных чатов (или с подтверждением «У вас открыт чат, обновить позже?»).

### 7.8 Установщик
- NSIS остаётся, но:
  - **Per-user install** по умолчанию (без UAC) → `installMode: "perUser"`.
  - Свой `installer.nsi` с темой, логотипом, шагом «Запустить после установки».
  - Подпись Authenticode (sign tool) — отдельно при наличии сертификата, иначе SmartScreen ругается. Это уже про деньги, опц.

### 7.9 Иконка приложения (SVG → ICO)
Новый SVG-логотип:
```
Книга в обложке золотого пергамента, в центре — стилизованная звёздочка, лёгкое сияние.
Палитра: #d97706 → #fbbf24, центр — #fde68a, контур #92400e.
```
Генерация: `tauri icon ./icon.svg` (использует sharp), даст ico/icns/png всех размеров. Шапка задачи — генерация моноварианта для трея (белый на прозрачном, для тёмной темы).

---

## 8. Производительность

| Метрика | Цель |
|---|---|
| Time-to-interactive (cold start desktop) | < 700 мс |
| FPS при скролле длинного чата (1000 сообщений) | стабильно 60 |
| Бандл widget.js (gzip) | ≤ 30 КБ |
| Memory steady-state (8 диалогов открыто) | < 250 МБ |

Меры:
- Виртуализация ленты сообщений и Sidebar.
- React.memo на MessageBubble.
- Сокеты не дублируют события, server room-based.
- Изображения: lazy + `loading="lazy"` + thumbnail-урлы с сервера.
- Tauri webview = WebView2 (Chromium), значит SVG/CSS/blur — дёшево.

---

## 9. Безопасность

1. **CSP** включить в `tauri.conf.json`: `default-src 'self'; img-src 'self' data: https://zhivaya-skazka.ru; connect-src 'self' wss://zhivaya-skazka.ru https://zhivaya-skazka.ru; style-src 'self' 'unsafe-inline'`.
2. Tauri capabilities — выдать минимальные права (notification, updater, window, fs только если нужен, tray).
3. JWT → stronghold (см. 7.5).
4. Логи не печатать в продакшне (logger.ts: env-gate).
5. Чистка XSS-векторов в widget (visitor_name через `textContent`, не innerHTML — кое-где встречается).

---

## 10. Качество кода и DX

- **ESLint flat + Prettier + typescript-strict** (сейчас `~5.8.3`, strict без noUncheckedIndexedAccess).
- **Husky + lint-staged** перед commit.
- **Vitest** для утилит + React Testing Library для критичных компонентов (inbox.store, composer, notifications).
- **Playwright e2e** — три золотых сценария: логин → новый чат → ответ → закрытие; перезапуск → восстановление; обновление приложения.
- **CI**: GitHub Actions — build Windows installer на каждый тег `v*.*.*`, выкладывает в `releases/` репо и обновляет `latest.json` через server-side webhook.

---

## 10.5 Статистика и «живой» экран посетителей — отдельный большой раздел 🌟

> Это **флагманская фича** на 2026 год. Оператор должен входить в десктоп и сразу чувствовать: «я вижу всех — кто, откуда, что смотрит, готов ли купить». Не сухая таблица, а **живая карта аудитории**.

### 10.5.1 Что есть сейчас
[src/components/screens/visitors-screen.tsx](src/components/screens/visitors-screen.tsx) (688 строк):
- Список посетителей сайта, группировка по дням.
- Поля: `current_page`, `referrer`, `city`, `country`, `browser`, `os`, `first_seen_at`, `last_seen_at`, `is_online`, `has_chat`.
- Сокеты: `visitor_ping` каждые 30 сек из [widget.js:1822](widget.js:1822).
- Можно отправить proactive-инвайт (`sendInvitation`).

**Слабости:** плоский список без визуала, нет графиков, нет реалтайм-«дыхания», нет UTM-аналитики, нет воронки, нет heatmap по часам, нет понимания «насколько горячий лид».

### 10.5.2 Концепция (обновлено после правок)

```
┌─────────────────────────────────────────────────────────────────┐
│ ВЕРХ:  4 KPI-плитки с анимированными счётчиками                  │
│  ┌─────────┬─────────┬─────────┬──────────┐                      │
│  │ Сейчас  │ За день │ Чатов   │ Конверсия│                      │
│  │   47    │  1 284  │  38     │  3.0%    │                      │
│  │ ●online │ +12% ↑  │ AHT 2:14│ ▲0.4 пп  │                      │
│  └─────────┴─────────┴─────────┴──────────┘                      │
├──────────────────────────────────────────────────────────────────┤
│  Переключатель сцен:                                             │
│   [📊 Графики] [🎯 Воронка] [📋 Посетители] [🔥 Heatmap]          │
│                                                                  │
│   ❌ Карта мира — не делаем.                                     │
│   ⚠ Live-лента — только если не нагружает сервер.               │
└──────────────────────────────────────────────────────────────────┘
```

Главное — **оптимизация и красота**, чтобы ничего не «досаждало» оператору. Все графики — с lazy-загрузкой, обновление не чаще раз в 30 сек, никакого спама ивентами.

### 10.5.3 ~~Сцена «Карта мира»~~ ❌ Отказались
Карта мира не нужна. Этот раздел удалён.

### 10.5.4 Сцена «Графики» (главная)

Грид 2×3 из **anim-charts** ([tremor.so](https://tremor.so) или recharts с пружинными переходами):

1. **Посетители по часам** — area-chart за сегодня vs прошлая неделя.
2. **Источники трафика** — donut с UTM-source (Yandex/Google/Direct/Telegram/VK).
3. **Топ страниц** — горизонтальные bars (книги-бестселлеры на сайте).
4. **Воронка**: посетители → открыли виджет → начали чат → купили (% перехода).
5. **Среднее время на сайте** — спарклайн.
6. **География** — топ-10 городов с прогресс-барами и флажками.

**Стиль:** карточки с glass-фоном, тени `0 24px 64px -16px rgba(217,119,6,.18)`, числа считаются от 0 при появлении (rolling-counter ~1.2 сек, ease-out).

### 10.5.5 Сцена «Воронка»
Классическая воронка из 5 шагов с анимированными процентами и **диагнозом**:
```
Зашли на сайт         1 284   100%
Прокрутили > 50%        892   69%   ↓ узкое место!
Открыли виджет          312   24%   ✦ виджет работает
Начали диалог           184   59% от открывших
Купили                   38   21% от диалогов
```
Подсветка проблемного шага красным + **AI-подсказка**: «72% теряются после landing-секции — попробуйте триггер scroll_percent на 30%».

### 10.5.6 Сцена «Heatmap часов × дней»
Календарная сетка 7×24 (как GitHub-contributions), цвет = нагрузка. Hover → «Понедельник 14:00 — обычно 28 посетителей, 4 чата, AHT 2:08». На основе этого — рекомендация графика смен операторов.

### 10.5.7 Сцена «Live-лента» ⚠️ под вопросом
> По комментарию пользователя: «может напрягать сайт». Рассмотрим только если backend-нагрузка будет минимальна (один WS-канал, throttling 1 событие/сек). Если не уверены — пропускаем эту сцену в первой версии.

Реалтайм-стрим событий, как Twitter-таймлайн, с анимацией slide-down и едва заметным звуком «*тинь*» (можно отключить):
- 🟢 «Новый посетитель из Казани» (IP → город)
- 👁 «Гость на странице /book/kurochka-ryaba 1:24»
- 💬 «Аня начала чат»
- 🚪 «Гость закрыл вкладку» (с грустным сказочным emoji 🥲)
- 🛒 «Покупка! Книга «Колобок» — 1 290 ₽» (триггер confetti)
- ✨ «Новый отзыв 5★»

Лента шириной 360px, sticky, auto-scroll, пауза при наведении.

### 10.5.8 Сцена «Список» (улучшение текущего)
- Виртуализированная таблица @tanstack/react-virtual.
- Колонки: аватар (identicon) / имя или ID / страна-флаг / страница / время на сайте / устройство / температура (🔥🌡️❄️) / действия.
- **Score «температуры лида»** (0–100), рассчитывается:
  - +30 за визит /pricing, /checkout
  - +20 за > 2 мин на сайте
  - +15 за повторный визит
  - +25 за UTM из платного источника
  - −10 за быстрое закрытие
  Цветовая шкала: ❄️ < 30, 🌡️ 30–60, 🔥 > 60.
- Action-меню на каждой строке: Пригласить / Заметка / Заблокировать / Открыть профиль / Показать путь.
- **«Путь посетителя»** — modal с timeline-каскадом страниц, временем на каждой, точкой выхода. Используем существующий `getVisitorHistory`.

### 10.5.9 Карточка профиля посетителя (drawer справа)
При клике — выезжает справа панель 480px:
```
┌───────────────────────────────┐
│ ◯ Гость v_1715847234          │
│   Москва, Россия 🇷🇺          │
│                              │
│ 🔥 Температура: 78/100       │
│ ▰▰▰▰▰▰▰▱▱▱                  │
│                              │
│ ⏱  На сайте: 4:32             │
│ 📍 Страница: /book/repka      │
│ 🔗 Откуда: yandex.ru          │
│ 💻 Chrome / Windows           │
│                              │
│ ── Путь ──                    │
│ /                  0:48      │
│ /books             1:12      │
│ /book/repka        2:32 ●    │
│                              │
│ ── История ──                 │
│ Был 3 раза, 1 покупка         │
│                              │
│ [Пригласить в чат]            │
│ [Отправить триггер]           │
└───────────────────────────────┘
```

### 10.5.10 Что нужно от бэка

| Эндпоинт | Назначение |
|---|---|
| `GET /api/stats/overview?range=today` | 4 KPI с дельтами к прошлому периоду |
| `GET /api/stats/timeseries?metric=visitors&granularity=hour&range=7d` | для графиков |
| `GET /api/stats/sources` | UTM breakdown |
| `GET /api/stats/funnel?range=7d` | воронка |
| `GET /api/stats/heatmap?range=30d` | часы×дни |
| `GET /api/visitors/live` | расширенный visitors с lead_score |
| `GET /api/visitors/:id/path` | timeline страниц |
| `WS events_stream` | поток событий для live-ленты |
| `GET /api/stats/export.csv` | экспорт CSV/XLSX |

**Lead-score** — лучше считать на сервере (одна точка истины). Формула в config, чтобы можно было крутить веса без релиза.

### 10.5.11 Реалтайм-«дыхание»
- WS-broadcast `visitor_event` с типами: `enter`, `page`, `idle`, `engage`, `leave`, `convert`.
- В сторе — circular buffer на 200 событий + react-query инвалидации.
- Запасной polling `GET /api/visitors/live` раз в 15 сек на случай сетевого глюка.
- Все анимации с учётом `prefers-reduced-motion`.

### 10.5.12 Эстетика
- Glass-карточки KPI с edge-lit золотым свечением.
- Числа в Onest Display, варьируемая толщина при изменении.
- При обновлении KPI — короткий «pulse»-glow (1 кадр).
- Карта мира — собственная стилизация: тёплая ночь, океаны #0f1419, суша #2a2218, границы #d97706 30%, активные регионы подсвечиваются.
- Звук обновления — едва слышимый «sparkle» (4 ноты пентатоники), отключаем в DND.

### 10.5.13 Что меняется в widget.js
- Шлём дополнительные поля в `visitor_ping`: `timezone`, `screen_dpr`, `connection.effectiveType`, `visibility_state`, `scroll_depth`, время на странице.
- Событие `widget_opened`, `widget_closed`, `quick_reply_clicked`, `form_submitted` — пайплайн в `events_stream`.
- При покупке (если интегрируемся с лендингом) — `purchase` event с суммой → confetti на десктопе.

### 10.5.14 Фаза разработки
Добавляется новая **Фаза 4.5 — Статистика** между «Чат» и «Виджет», 3–4 дня:
1. KPI-плитки + rolling-counter — 0.5 д
2. Графики (Tremor) + API — 1 д
3. Карта мира с MapLibre — 1 д
4. Live-лента + lead-score — 0.5 д
5. Воронка + heatmap — 0.5 д
6. Drawer профиля + путь — 0.5 д

---

## 11. Дорожная карта (по фазам, фазы маленькие)

### Фаза 1 — Фундамент (1–2 дня)
- Чистка дублей: `lib/notifications.ts` → удалить, оставить только `store/notification.store.ts`.
- Создать `design-system/tokens.css`, переехать на CSS-переменные везде.
- Починить тривиальные баги: п.1.3 № 1–5, 8, 11.
- Обновить tauri.conf: title, перевести `installMode: "perUser"`, починить заголовок окна.
- Новый SVG-логотип + `tauri icon`.

### Фаза 2 — Layout 2026 (2–3 дня)
- Top-bar + ⌘K палитра.
- Разбить толстые компоненты (chat-main, chat-details, chat-composer, widget-settings).
- Resizeable панели, persistence в `ui.store`.
- Темы light/dark/fairytale.

### Фаза 3 — Уведомления (1–2 дня)
- Native WinRT с inline-reply, action-buttons.
- Tray dynamic badge с цифрой.
- DND-логика «в чате», mute per-chat.

### Фаза 4 — Чат (2–3 дня)
- Виртуализация, реакции, лучше reply, файлы DnD, голосовые (опц.), черновики.

### Фаза 4.5 — Статистика и живые посетители (3–4 дня) 🌟
- KPI-плитки с rolling-counter + дельтами.
- Графики Tremor/recharts с пружинными анимациями.
- Карта мира MapLibre со сказочным стилем + пульсация точек.
- Live-лента событий, lead-score, воронка, heatmap.
- Drawer профиля посетителя с timeline-путём.

### Фаза 5 — Виджет 6.0 (3–4 дня)
- Каркас в `widget-src/`, Rollup-сборка.
- Diff-рендер, утечки таймеров, ES-модули.
- Сказочные темы по умолчанию, плеер сказок.

### Фаза 6 — Polish (1–2 дня)
- Анимации framer-motion spring presets.
- A11y-чек, prefers-reduced-motion.
- Тесты, e2e, CI.

### Фаза 7 — Платформа (1–2 дня)
- single-instance, deep-link, autostart, global-shortcut, stronghold.
- Дельта-обновления с user-friendly UI.

Итого: **~10–14 рабочих дней** при фокусе. Каждую фазу можно релизить (v4.1, 4.2, … 5.0).

---

## 12. Идеи — что берём, что не берём

✅ **Берём:**
1. **«Сказочный/сезонный режим»** — easter egg: переключение акцентов и иконок по сезону/дате. 1 сентября — школа, Новый Год — снежок, Масленица — узоры. Включается/выключается в настройках.
2. **CSAT-микро-опрос** после закрытия чата — есть rating, добавим аналитику в десктоп.
3. **Sidebar collapse to icons** — Ctrl+B, как VS Code, удобно для маленьких экранов.
4. **Smart status** — авто-«away» через 5 мин неактивности, авто-«online» при возврате.
5. **Heatmap нагрузки** — внутри экрана «Посетители» как сцена.
6. **Трей: ПКМ-меню** — «Открыть / Свернуть / Закрыть полностью», чтобы можно было реально выйти из приложения, а не только свернуть.

❌ **Не берём:**
- AI-кнопка «Сократи/Переформулируй» — не нужна.
- Pop-out chat в отдельное окно — не нужно.
- Сводка дня в трее — не нужна.
- Шторка ассистента — не нужна.
- Парные операторы — не нужны.

---

## 13. Что НЕ делаем сейчас

- Не трогаем Android-уведомления (по просьбе пользователя).
- Не делаем macOS-сборку, пока не запрошено.
- Не вводим i18n до явного решения (русский остаётся).
- Не меняем БД-схему — она достаточна.

---

## 14. Конкретные первые правки (после твоего «ок»)

Микро-PR'ы, чтобы быстро увидеть результат:

1. SVG-логотип + новые иконки приложения. (~10 файлов в `src-tauri/icons/`)
2. `design-system/tokens.css` + переезд `App.css`-аналогов на токены.
3. Удалить `src/lib/notifications.ts` (мёртвый код), оставить только `notification.store`.
4. Фикс утечек widget.js (таймеры, listeners, socket re-handler).
5. Tauri: фикс title, `perUser`, заголовок окна.

---

## 15. Решённые и оставшиеся вопросы

**Решено пользователем (2026-05-19):**
- ❌ Дашборд / Аналитика / AI-сократи / Pop-out / Сводка в трее / Шторка ассистента / Парные операторы — не делаем.
- ❌ В виджете: плеер сказок, PDF, обратный звонок, прогресс ответа оператора, карусель quick-replies — не нужно.
- ❌ В статистике: карта мира — не делаем.
- ⚠ Live-лента — только если не нагружает сервер.
- ✅ Сегменты (4), сценарии гибче, превью виджета + A/B, шаблоны ответов CRUD, поиск, glass-морфизм, профиль посетителя, heatmap, сезонные темы.
- ✅ Виджет = ОДИН файл на выходе (исходник в widget-src/, сборка Rollup).
- ✅ В трее — ПКМ-меню с «Закрыть полностью».
- ✅ Стилистика лендинга «Живая Сказка» (тёплая золотисто-кремовая) как основа.
- ✅ Кастомизация стиля внутри самого приложения для операторов.

**Остаются открытыми (не блокеры, можно ответить по ходу):**
1. Подпись Authenticode (сертификат) — оставляем как nice-to-have. Без него Windows SmartScreen ругается при первом запуске инсталлятора.
2. Аватары клиентов в уведомлениях — генерировать identicon на сервере, если нет реального avatar_url.
3. Сезонные темы — какие именно даты использовать? Подберу разумный набор по умолчанию, можно поправить потом.

---

## 16. Журнал работы (обновляется по ходу)

Веду список выполненных шагов прямо здесь, чтобы можно было откатываться и видеть прогресс.

| Дата | Фаза | Что сделано | Файлы |
|---|---|---|---|
| 2026-05-19 | 0 | План создан и согласован v2 | docs/REDESIGN_PLAN_2026.md |
| 2026-05-19 | 1 | Фикс title в tauri.conf.json (битый em-dash → «Живая Сказка — Оператор») | src-tauri/tauri.conf.json |
| 2026-05-19 | 1 | Добавлена тема `data-theme="fairytale"` (золото + кремовый пергамент) + brand-токены | src/styles/tokens.css |
| 2026-05-19 | 1 | Чистка мёртвого кода в lib/notifications.ts (удалены неиспользуемые notifyNewChat/notifyNewMessage и дублирующие beep'ы — оставлены только unlockAudio и requestNotificationPermission, основная логика в notification.store) | src/lib/notifications.ts |
| 2026-05-19 | 1 | Фикс утечки heartbeat: useEffect теперь зависит от operator.id (при смене юзера всё переподнимается) | src/features/inbox/use-inbox.ts |
| 2026-05-19 | 1 | Фикс socket.off("operator_requested") без handler — теперь отвязываем именно своего | src/features/inbox/use-inbox-realtime.ts |
| 2026-05-19 | 1 | Виджет: устранены утечки таймеров `visitorPingTimer`/`pageCheckTimer` — теперь стартуют на каждом `connect`, корректно останавливаются на `disconnect`, не дублируются. setupSessionHandlers защищён флагом `_handlersAttached` от повторного навешивания | widget.js |
| 2026-05-19 | 1 | Виджет: глобальные `visibilitychange` listener и SPA-tracking `setInterval` защищены флагом `window.__zsGlobalsAttached` от повторных подписок при повторной загрузке скрипта | widget.js |
| 2026-05-19 | 1.5 | SVG-логотип «Живая Сказка» создан (книга-пергамент + золотая звезда + сияние, viewBox 1024×1024) | src-tauri/icons/logo.svg, public/logo.svg |
| 2026-05-19 | 1.5 | Сгенерированы все иконки приложения через `npx tauri icon`: Windows .ico, macOS .icns, PNG-сетка 32/128/128@2x, iOS AppIcon-набор, Android mipmap (hdpi…xxxhdpi) | src-tauri/icons/* |
| 2026-05-19 | 1.5 | Обновлён index.html: title «Живая Сказка — Оператор», favicon → /logo.svg | index.html |
| 2026-05-19 | 2 | TopBar 44px с glass-эффектом: бренд+лого, поиск-кнопка `Ctrl+K`, переключатель тем (fairytale/light/dark/system) | src/components/layout/top-bar.tsx, TopBar.module.css |
| 2026-05-19 | 2 | Command Palette `Ctrl+K`: поиск по чатам, навигация по экранам, смена темы, действия. Клавиатура ↑↓ ↵ Esc | src/components/layout/command-palette.tsx, CommandPalette.module.css |
| 2026-05-19 | 2 | theme.store расширен: тема `fairytale` по умолчанию + accentHue (0..360) + density (comfortable/compact). Live-апплай через `data-theme` / `data-density` / `--accent-hue` | src/store/theme.store.ts |
| 2026-05-19 | 2 | Density-токены + glass-токены в tokens.css | src/styles/tokens.css |
| 2026-05-19 | 2 | AppShell обёрнут в flex-column, TopBar сверху, grid с layoutом снизу | src/components/layout/app-shell.tsx, AppShell.module.css |
| 2026-05-19 | 3 | Контекстное меню трея (ПКМ): «Открыть Живая Сказка», «Свернуть в трей», «Закрыть полностью» (принудительный выход с обходом close-to-tray) | src-tauri/src/lib.rs |
| 2026-05-19 | 3 | Везде заменено «Alphabet Chat» → «Живая Сказка» (Rust tooltip, document.title, badge-формат) | src-tauri/src/lib.rs, src/lib/tauri-bridge.ts, src/store/notification.store.ts |
| 2026-05-19 | 4 | Sidebar: сегменты в фильтре «Входящие» — 🔥 Срочные / ⏰ Ждут оператора / 👤 Мои / 🤖 У бота / ✓ Закрытые. Sticky-заголовки секций с счётчиком. Фикс: «Мои» теперь по operator_id, а не по статусу | src/components/layout/chat-sidebar.tsx, ChatSidebar.module.css |
| 2026-05-19 | 4 | Drafts store: автосохранение черновика composer'а per-session с debounce 400 мс, восстановление при возврате, очистка после отправки. persist в localStorage | src/store/drafts.store.ts, src/components/layout/chat-composer.tsx |
| 2026-05-19 | 4.5 | KPI-блок на экране Посетители: 4 плитки с rolling-counter (Сейчас на сайте / Всего / Активные чаты / Завершено), glass-стиль | src/components/screens/visitors-stats.tsx, VisitorsStats.module.css |
| 2026-05-19 | 4.5 | Воронка вовлечения (5 шагов) с горизонтальными gradient-барами, процент перехода между шагами | src/components/screens/visitors-stats.tsx |
| 2026-05-19 | 4.5 | Heatmap нагрузки 7×24 (часы × дни) за 14 дней, теплота золотая (rgba амбер), hover-tooltip | src/components/screens/visitors-stats.tsx |
| 2026-05-19 | 5 | Виджет: дефолтные цвета сменены с фиолетовый/розовый (#8b5cf6/#ec4899) на сказочные золото-амбер (#d97706/#fbbf24). Дефолтный шрифт — Onest (загружается с Google Fonts) | widget.js |
| 2026-05-19 | 7 | ErrorBoundary в provider'е и поверх каждого крупного компонента (ChatSidebar/ChatMain/ChatDetails) — один сбойный компонент больше не валит весь shell | src/app/error-boundary.tsx, src/providers/app-provider.tsx, src/components/layout/app-shell.tsx |
| 2026-05-19 | 5 | Виджет: защита от двойной инициализации (флаг window.__zsWidgetInited) | widget.js |
| 2026-05-19 | 5 | Виджет: in-widget тосты «Оператор подключился» / «Чат завершён» с золотисто-зелёной градиентной стилистикой, slide-down анимация, auto-dismiss 3.2 с | widget.js |
| 2026-05-19 | 5 | Виджет: улучшен FAB — двойная тень с inset highlight, slight lift on hover, press-effect, drop-shadow на иконку | widget.js |
| 2026-05-19 | 6 | CRUD шаблонов ответов: persist-стор templates.store с дефолтными 4 шаблонами, поддержка переменных {{name}} {{operator}} {{date}}, шорткаты `/команда`, счётчик использований | src/store/templates.store.ts |
| 2026-05-19 | 6 | Экран «Шаблоны ответов»: grid-карточки с edit/delete, модалка создания/редактирования, sorted by uses, подключён в rail и command-palette | src/components/screens/templates-screen.tsx, TemplatesScreen.module.css |
| 2026-05-19 | 6 | Composer: popover теперь показывает наши шаблоны (отсортированные по популярности) с разрешёнными переменными. Slash-команды: ввод `/привет ...` → автозамена на шаблон при отправке | src/components/layout/chat-composer.tsx |
| 2026-05-19 | 7+ | Чат-редизайн: header чата получил glass-эффект, bubble оператора — inset-highlight + lift-on-hover, AI-bubble — золотая звёздочка-метка ✦ в углу, увеличены радиусы | src/components/layout/ChatMain.module.css, ChatSidebar.module.css |
| 2026-05-19 | 7+ | Мобильный список: glass-шапка с логотипом-фавиконкой, серифный заголовок, карточки с unread-подсветкой и press-анимацией | src/components/layout/MobileChatList.module.css, mobile-chat-list.tsx |
| 2026-05-19 | 8 | Виртуализация ленты сообщений на уровне браузера: `content-visibility:auto + contain-intrinsic-size` на `.msgRow` — WebView2 пропускает рендер невидимых сообщений без перестройки JSX | src/components/layout/ChatMain.module.css |
| 2026-05-19 | 8 | Реакции на сообщения — уже встроены в chat-main.tsx: hover-bar с быстрыми эмодзи + tag-pills с количеством и подсказкой кто реагировал | src/components/layout/chat-main.tsx (review only) |
| 2026-05-19 | 8 | Динамический tray-icon: при count > 0 рисуется красный AA-кружок с белой обводкой в правом нижнем углу базовой иконки (image crate в Rust), set_icon вызывается из set_badge_count | src-tauri/src/tray_icon.rs, src-tauri/Cargo.toml, src-tauri/src/lib.rs |
| 2026-05-19 | 8 | Версия повышена 4.0.2 → 5.0.0 во всех трёх местах (tauri.conf, Cargo, package.json) | tauri.conf.json, src-tauri/Cargo.toml, package.json |
| 2026-05-19 | 8 | Live-превью виджета в widget-settings: переключатель «📱 Mobile / 📋 Tablet / 🖥️ Desktop» в заголовке предпросмотра, max-width контейнера меняется с пружинной анимацией | src/components/screens/widget-settings-screen.tsx, WidgetSettingsScreen.module.css |
| 2026-05-19 | 8 | Мобильный чат-вью: glass sticky header, glass sticky composer, bubble-стилистика приведена к сказочной (gold gradient у оператора с inset-highlight, парчмент у AI + ✦, тонкая обводка у visitor) | src/components/layout/MobileChatView.module.css |
| 2026-05-19 | 9 | **Эргономика**: глобальные правила в global.css — focus-visible 2px accent, button:active scale(0.97), prefers-reduced-motion. Убраны `transform: translateY(-1px)` со всех hover в Button, ChatMain bubbles, OperatorCard, TemplatesScreen, VisitorsStats, ChatSidebar, VisitorsScreen — кнопки больше не «прыгают» | src/styles/global.css, многие *.module.css |
| 2026-05-19 | 9 | **Виджет — внешний вид**: 5 новых опций. Ширина окна (340/380/420), отступ от края (16/24/32/40), скругление сообщений (12/18/6), сила тени (subtle/medium/strong), размер шрифта (13/14/15/16). Дефолтный шрифт `onest` | widget.js, settings.api.ts, widget-settings-screen.tsx |
| 2026-05-19 | 9 | **Виджет — поведение**: 5 новых опций. remember_open_state (запомнить открыто/закрыто между визитами), greet_once (приветствие 1 раз), auto_minimize_after (свернуть через N сек неактивности), hide_unread_badge (скрыть счётчик), disable_sound_for_visitor (запрет звука у клиента) | widget.js, settings.api.ts, widget-settings-screen.tsx |
| 2026-05-19 | 9 | **Прочат-форма**: золотой ambient glow за аватаром, бóльшая аватарка 72px с 4px white-ring + двойной shadow, увеличенные отступы, гладкие hover-состояния полей, focus-кольцо 4px вместо 3px, button с inset-highlight и filter brightness на hover | widget.js |
| 2026-05-19 | 10 | **Мобильные настройки виджета**: 6 новых полей (mobile_launcher_type, mobile_window_mode «fullscreen/bottom_sheet/popup», mobile_invitation_enabled/text/delay, mobile_hide_unread_badge). Bottom-sheet режим открывает виджет на 75dvh с радиусом сверху — не закрывает весь экран | widget.js, settings.api.ts, widget-settings-screen.tsx |
| 2026-05-19 | 10 | **Мобильное приглашение**: всплывающая подсказка «Нужна помощь? Нажмите!» над FAB через N сек, с кнопкой закрытия и кликом для открытия чата. Pop-анимация | widget.js |
| 2026-05-19 | 10 | **Видимость виджета по страницам**: 3 режима (везде / только на этих / везде кроме этих). Проверка на init по подстроке URL | widget.js, settings.api.ts, widget-settings-screen.tsx |
| 2026-05-19 | 10 | **Live-превью**: применены реальные настройки шрифт (font_family), размер шрифта, отступ от края, скругление сообщений, ширина окна, сила тени FAB. Превью теперь действительно показывает изменения | widget-settings-screen.tsx, WidgetSettingsScreen.module.css |
