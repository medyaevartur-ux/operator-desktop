(function() {
  "use strict";

  // Защита от двойной инициализации (если script подключили дважды).
  if (window.__zsWidgetInited) return;
  window.__zsWidgetInited = true;

  const SCRIPT = document.currentScript;
  const API_BASE = (window.__zsPreviewConfig && window.__zsPreviewConfig.api_base) || (SCRIPT && SCRIPT.getAttribute("data-api")) || "https://zhivaya-skazka.ru";
  const VISITOR_KEY = "zs_visitor_id";
  const SOUND_KEY = "zs_sound_enabled";

  // ═══ SOUND ═══
  function playSound() {
    if (localStorage.getItem(SOUND_KEY) === "0") return;
    // принудительное отключение со стороны оператора
    if (typeof state !== "undefined" && state.config && state.config.disable_sound_for_visitor === true) return;
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.frequency.setValueAtTime(800, c.currentTime);
      o.frequency.setValueAtTime(600, c.currentTime + 0.1);
      o.frequency.setValueAtTime(800, c.currentTime + 0.2);
      g.gain.setValueAtTime(0.3, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.4);
      o.start(c.currentTime); o.stop(c.currentTime + 0.4);
    } catch(e) { console.warn("[ZS] Sound error:", e); }
  }

  // ВАЖНО: isSoundOn вызывается во время инициализации state — нельзя обращаться к state здесь.
  function isSoundOn() {
    return localStorage.getItem(SOUND_KEY) !== "0";
  }
  // Учитывает принудительное отключение со стороны оператора (вызывается уже когда config загружен).
  function isSoundAllowed() {
    if (typeof state !== "undefined" && state.config && state.config.disable_sound_for_visitor === true) return false;
    return isSoundOn();
  }
  function toggleSound() {
    const on = isSoundOn();
    localStorage.setItem(SOUND_KEY, on ? "0" : "1");
    state.soundOn = !on;
    scheduleRender();
  }

  // ═══ UTIL ═══
  function genId() {
    // Новым посетителям выдаём непредсказуемый UUID (crypto.randomUUID), с фолбэком
    // на старый способ для окружений без Web Crypto. Существующий id из localStorage не трогаем.
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return "v_" + crypto.randomUUID();
      }
    } catch (e) { /* ignore */ }
    return "v_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) { id = genId(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
  }

  const UTM_KEY = "zs_utm";
  // First-touch атрибуция: метки utm_* захватываются из URL при первом заходе
  // и сохраняются, чтобы источник трафика не терялся при переходах по сайту.
  function getUtm() {
    try {
      const params = new URLSearchParams(location.search);
      const fresh = {
        utm_source: params.get("utm_source") || "",
        utm_medium: params.get("utm_medium") || "",
        utm_campaign: params.get("utm_campaign") || ""
      };
      if (fresh.utm_source || fresh.utm_medium || fresh.utm_campaign) {
        if (!localStorage.getItem(UTM_KEY)) localStorage.setItem(UTM_KEY, JSON.stringify(fresh));
        return fresh;
      }
      const stored = localStorage.getItem(UTM_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    return { utm_source: "", utm_medium: "", utm_campaign: "" };
  }

  function esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function parseMarkdown(text) {
    if (!text) return "";
    let s = esc(text);
    // Parse bold: **text**
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Parse italic: *text*
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Parse inline code: `text`
    s = s.replace(/`(.*?)`/g, "<code>$1</code>");
    // Parse simple line breaks: \n -> <br>
    s = s.replace(/\n/g, "<br>");
    return s;
  }

  function fmtTime(s) {
    if (!s) return "";
    return new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function sanitizeCSS(css) {
    return (css || "")
      .replace(/<\/style>/gi, "")
      .replace(/<script/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/expression\s*\(/gi, "")
      .replace(/@import/gi, "")
      .replace(/url\s*\(\s*["']?\s*data:/gi, "url(");
  }

  function isSafeImgUrl(url) {
    try {
      const u = new URL(url, API_BASE);
      return /^https?:$/i.test(u.protocol) && /\.(jpg|jpeg|png|webp|gif)$/i.test(u.pathname);
    } catch { return false; }
  }

  function getMsgImg(m) {
    if (!m) return null;
    let a = null;
    try {
      if (m.attachments && typeof m.attachments === "string") a = JSON.parse(m.attachments);
      else if (Array.isArray(m.attachments)) a = m.attachments;
    } catch(e) {}
    if (a && a[0] && a[0].url && isSafeImgUrl(a[0].url)) return a[0].url;
    if (m.message_type === "image" && m.message && isSafeImgUrl(m.message)) return m.message;
    if (m.image_url && isSafeImgUrl(m.image_url)) return m.image_url;
    if (isSafeImgUrl(m.message || "")) return m.message;
    return null;
  }

  // ═══ ASYNC API ═══
  async function api(method, path, body) {
    const headers = {};
    let sendBody = body;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      sendBody = JSON.stringify(body);
    }
    // Контракт с сервером: на все запросы к сессиям шлём идентификатор посетителя.
    // Покрывает /api/widget/sessions/:id (GET/POST/PATCH messages, status, page, deliver, read, rate, bot-event).
    try {
      if (path.indexOf("/api/widget/sessions") === 0 && typeof state !== "undefined" && state.visitorId) {
        headers["X-Visitor-Id"] = state.visitorId;
      }
    } catch (e) { /* ignore */ }
    try {
      const res = await fetch(API_BASE + path, { method, headers, body: sendBody });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch(e) {
      console.warn("[ZS] API " + method + " " + path + " failed:", e);
      return null;
    }
  }

  // ═══ GRADIENT HELPERS ═══
  function getFabBg(cfg) {
    const gt = cfg.gradient_type || "solid";
    const c = cfg.color || "#e8530e";
    const gf = cfg.gradient_from || c;
    const gto = cfg.gradient_to || "#f5a623";
    const ga = cfg.gradient_angle || 135;
    if (gt === "gradient") return "linear-gradient(" + ga + "deg," + gf + "," + gto + ")";
    if (gt === "glass") return "rgba(255,255,255,0.15)";
    if (gt === "animated") return "linear-gradient(270deg," + gf + "," + gto + "," + gf + ")";
    return c;
  }

  function getHdrBg(cfg) {
    const gt = cfg.gradient_type || "solid";
    const c = cfg.color || "#e8530e";
    const gf = cfg.gradient_from || c;
    const gto = cfg.gradient_to || "#f5a623";
    const ga = cfg.gradient_angle || 135;
    if (gt === "gradient") return "linear-gradient(" + ga + "deg," + gf + "," + gto + ")";
    if (gt === "animated") return "linear-gradient(270deg," + gf + "," + gto + "," + gf + ")";
    return c;
  }

  // ═══ THEME HELPERS ═══
  function getThemeVars(cfg) {
    const t = cfg.theme || "light";
    if (t === "dark") return { bg:"#1e1e2e", text:"#e2e8f0", bubble:"#2a2a3e", border:"#3a3a5e", msgsBg:"linear-gradient(180deg,#1a1a2e 0%,#1e1e2e 100%)", inputBg:"#2a2a3e", inputBorder:"#3a3a5e", sysBg:"#2a2a3e", sysText:"#9ca3af" };
    if (t === "custom") return { bg:cfg.custom_bg||"#fff", text:cfg.custom_text||"#1f2937", bubble:cfg.custom_bubble_bg||"#f3f4f6", border:cfg.custom_border||"#e5e7eb", msgsBg:"linear-gradient(180deg,"+(cfg.custom_bg||"#fff")+" 0%,"+(cfg.custom_bg||"#fff")+" 100%)", inputBg:cfg.custom_bg||"#fff", inputBorder:cfg.custom_border||"#e5e7eb", sysBg:cfg.custom_bubble_bg||"#f3f4f6", sysText:cfg.custom_text||"#6b7280" };
    if (t === "auto") {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) return { bg:"#1e1e2e", text:"#e2e8f0", bubble:"#2a2a3e", border:"#3a3a5e", msgsBg:"linear-gradient(180deg,#1a1a2e 0%,#1e1e2e 100%)", inputBg:"#2a2a3e", inputBorder:"#3a3a5e", sysBg:"#2a2a3e", sysText:"#9ca3af" };
    }
    // Тёплый «warm»-пресет под палитру сайта (крем + земляные тона) — дефолт и light-тема.
    return { bg:"#fffdf9", text:"#1a1206", bubble:"#f5ede3", border:"#e5ddd3", msgsBg:"linear-gradient(180deg,#faf5ee 0%,#fffdf9 100%)", inputBg:"#fff", inputBorder:"#e5ddd3", sysBg:"#ede6dc", sysText:"#8c8072" };
  }

  // ═══ FONT HELPER ═══
  // Дефолт — наследуем шрифт сайта (zhivaya-skazka.ru использует Inter, self-hosted с кириллицей).
  // Системный стек выбран так, чтобы Inter с сайта подхватывался, а без него — нативный шрифт ОС.
  const SITE_FONT_STACK = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  function getFontFamily(cfg) {
    const f = cfg.font_family || "";
    if (!f || f === "system" || f === "inherit-site") return SITE_FONT_STACK;
    if (f === "onest") return '"Onest","Inter",-apple-system,BlinkMacSystemFont,sans-serif';
    if (f === "inter") return '"Inter",sans-serif';
    if (f === "roboto") return '"Roboto",sans-serif';
    if (f === "montserrat") return '"Montserrat",sans-serif';
    if (f === "custom" && cfg.custom_font_url) return '"CustomWidgetFont",sans-serif';
    return SITE_FONT_STACK;
  }

  const _fontLoaded = {};
  function loadFontUrl(url) {
    if (_fontLoaded[url]) return;
    _fontLoaded[url] = true;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = url;
    document.head.appendChild(link);
  }

  function loadFont(cfg) {
    const f = cfg.font_family || "";
    // Пустой/system/inherit-site — НЕ грузим Google Fonts: наследуем шрифт сайта, экономим запрос.
    if (!f || f === "system" || f === "inherit-site") return;
    if (f === "onest") loadFontUrl("https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap");
    else if (f === "inter") loadFontUrl("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap");
    else if (f === "roboto") loadFontUrl("https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap");
    else if (f === "montserrat") loadFontUrl("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap");
    else if (f === "custom" && cfg.custom_font_url) loadFontUrl(cfg.custom_font_url);
  }

  // ═══ STATE ═══
  const state = {
    open: false, config: null, prechat: null, session: null,
    messages: [], visitorId: getVisitorId(),
    visitorDraftMessage: "", prechatDrafts: {},
    cardDismissed: !!sessionStorage.getItem("zs_card_dismissed"),
    visitorName: localStorage.getItem("zs_visitor_name") || "",
    prechatDone: !!localStorage.getItem("zs_prechat_done"),
    socket: null, unread: 0, typing: false, typingTimeout: null,
    connected: false, soundOn: isSoundOn(), uploading: false,
    lightboxUrl: null, deliveredIds: {}, readIds: {},
    sessionPollTimer: null, showRating: false, ratingSubmitted: false,
    sending: false,
    businessHours: null,
    domainSettings: null,
    isOffline: false,
    pendingInvitation: null,
    teamOperators: null,
    // greeting / mobile invite persistence (один раз на вкладку)
    greetDismissed: !!sessionStorage.getItem("zs_greet_dismissed"),
    mobileInviteDismissed: !!sessionStorage.getItem("zs_mobinvite_dismissed"),
    mobileInviteShown: false,
    // triggers — подавление дублей в рамках вкладки (sessionStorage)
    exitShown: !!sessionStorage.getItem("zw_exit_trigger"),
    scrollShown: !!sessionStorage.getItem("zw_scroll_trigger"),
    idleTimer: null, idleShown: !!sessionStorage.getItem("zw_idle_trigger"),
    // auto messages
    autoMsgShown: {}, autoMsgTimers: [],
    // offline form
    offlineFormSent: false,
    showOfflineLeadForm: false,
    // identity
    identityUser: null,
    // refs for incremental updates
    refs: { root: null, win: null, msgs: null, fab: null, badge: null, typingEl: null, headerSt: null, headerDot: null, headerName: null },
    // render batching
    _renderScheduled: false,
    _lastRenderedMsgCount: 0,
  };

  // ═══ RENDER BATCHING ═══
  function scheduleRender() {
    if (state._renderScheduled) return;
    state._renderScheduled = true;
    requestAnimationFrame(() => {
      state._renderScheduled = false;
      render();
    });
  }

  // ═══ SHADOW DOM ═══
  const host = document.createElement("div");
  host.id = "zs-widget-host";
  host.style.cssText = "position: fixed !important; z-index: 2147483647 !important; pointer-events: none; left: 0; right: 0; bottom: 0; top: 0; height: 0; width: 0; overflow: visible; display: block;";
  const shadow = host.attachShadow({ mode: "closed" });
  document.body.appendChild(host);

  // ═══ ICONS ═══
  const IC = {
    chat: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    person: '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    image: '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
    headphones: '<svg viewBox="0 0 24 24"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    checkDbl: '<svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    help: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>',
    // Sparkles/искра — для button_icon:"custom" (третий вариант в UI настроек).
    custom: '<svg viewBox="0 0 24 24"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zm6 12l.95 2.55L21.5 17.5l-2.55.95L18 21l-.95-2.55L14.5 17.5l2.55-.95L18 14zM6 15l.8 2.2L9 18l-2.2.8L6 21l-.8-2.2L3 18l2.2-.8L6 15z"/></svg>',
  };
  // ═══ CSS ═══
  function getCSS(cfg) {
    const c = cfg?.color || "#e8530e";
    const pos = cfg?.position || "bottom-right";
    const isR = pos.indexOf("right") !== -1;
    const side = isR ? "right" : "left";
    const safeCss = sanitizeCSS(cfg.custom_css);
    const tv = getThemeVars(cfg);
    // Пузырь оператора/карточки: в светлой/warm-теме — белый с тёплым бордером (как на сайте),
    // в тёмной/кастомной — наследуют theme-цвета, чтобы не было белых пятен на тёмном фоне.
    // Тёмную тему распознаём по факту (auto мог разрешиться в dark) — через tv.bg.
    const isDarkTheme = (cfg.theme === "dark") || (cfg.theme === "custom") || (tv.bg === "#1e1e2e");
    const opBubbleBg = isDarkTheme ? tv.bubble : "#fff";
    const opBubbleBorder = isDarkTheme ? tv.border : "#ede6dc";
    const fabBg = getFabBg(cfg);
    const hdrBg = getHdrBg(cfg);
    const ff = getFontFamily(cfg);
    const gt = cfg.gradient_type || "solid";

    const oa = cfg.open_animation || "slide";
    let winHidden, winVisible;
    if (oa === "pop") { winHidden = "opacity:0;transform:scale(0.5);"; winVisible = "opacity:1;transform:scale(1);"; }
    else if (oa === "fade") { winHidden = "opacity:0;transform:none;"; winVisible = "opacity:1;transform:none;"; }
    else if (oa === "bounce") { winHidden = "opacity:0;transform:translateY(40px);"; winVisible = "opacity:1;transform:translateY(0);"; }
    else if (oa === "flip") { winHidden = "opacity:0;transform:perspective(600px) rotateX(20deg);"; winVisible = "opacity:1;transform:perspective(600px) rotateX(0);"; }
    else { winHidden = "opacity:0;transform:translateY(16px) scale(0.95);"; winVisible = "opacity:1;transform:translateY(0) scale(1);"; }

    const fabSize = cfg.button_size === "small" ? "48px" : cfg.button_size === "large" ? "64px" : "56px";
    const fabRadius = cfg.button_radius === "round" ? "50%" : cfg.button_radius === "square" ? "8px" : "16px";
    const pulseRadius = cfg.button_radius === "round" ? "50%" : cfg.button_radius === "square" ? "12px" : "20px";

    // Расширенные настройки (с дефолтами для обратной совместимости).
    const winWidth = cfg.window_width === "narrow" ? "340px" : cfg.window_width === "wide" ? "420px" : "380px";
    const edgeMargin = (cfg.edge_margin || 24) + "px";
    const bubbleR = cfg.bubble_radius === "soft" ? "12px" : cfg.bubble_radius === "sharp" ? "6px" : "18px";
    const fontSize = (cfg.font_size_base || 14) + "px";
    const shadowI = cfg.shadow_intensity || "medium";
    // Тени тонированы тёплым #1a1206 (НЕ чистый чёрный) — под палитру сайта.
    const winShadow =
      shadowI === "subtle" ? "0 4px 16px rgba(26,18,6,0.08)" :
      shadowI === "strong" ? "0 24px 60px rgba(26,18,6,0.28)" :
      "0 12px 48px rgba(26,18,6,0.18)";
    const fabShadow =
      shadowI === "subtle" ? "0 2px 8px var(--accent-30)" :
      shadowI === "strong" ? "0 8px 28px var(--accent-60)" :
      "0 4px 20px var(--accent-25)";
    const hdrStyle = cfg.header_style || "light";

    return `
:host {
  all: initial;
  isolation: isolate;
  --ez-expo: cubic-bezier(.16,1,.3,1);
  --ez-back: cubic-bezier(.34,1.56,.64,1);
  --accent: ${c};
  /* Альфа-варианты акцента через color-mix — работают при любом формате цвета оператора (hex/rgb/hsl) */
  --accent-80: color-mix(in srgb, var(--accent) 80%, transparent);
  --accent-60: color-mix(in srgb, var(--accent) 60%, transparent);
  --accent-50: color-mix(in srgb, var(--accent) 50%, transparent);
  --accent-40: color-mix(in srgb, var(--accent) 40%, transparent);
  --accent-35: color-mix(in srgb, var(--accent) 35%, transparent);
  --accent-30: color-mix(in srgb, var(--accent) 30%, transparent);
  --accent-25: color-mix(in srgb, var(--accent) 25%, transparent);
  --accent-20: color-mix(in srgb, var(--accent) 20%, transparent);
  --accent-18: color-mix(in srgb, var(--accent) 18%, transparent);
  --accent-08: color-mix(in srgb, var(--accent) 8%, transparent);
  --bg: ${tv.bg};
  --text: ${tv.text};
  --bubble: ${tv.bubble};
  --op-bubble-bg: ${opBubbleBg};
  --op-bubble-border: ${opBubbleBorder};
  --border: ${tv.border};
  --msgs-bg: ${tv.msgsBg};
  --input-bg: ${tv.inputBg};
  --input-border: ${tv.inputBorder};
  --sys-bg: ${tv.sysBg};
  --sys-text: ${tv.sysText};
  --fab-bg: ${fabBg};
  --send-bg: ${(() => {
    // Кнопка отправки: тот же акцент, что у лончера — уважает gradient_type.
    // solid/glass → сплошной cfg.color; gradient/animated → градиент from→to.
    const sc = cfg.color || "#e8530e";
    const gt = cfg.gradient_type || "solid";
    if (gt === "gradient" || gt === "animated") {
      const sga = cfg.gradient_angle || 135;
      return "linear-gradient(" + sga + "deg," + (cfg.gradient_from || sc) + "," + (cfg.gradient_to || "#f5a623") + ")";
    }
    return sc;
  })()};
  --fab-size: ${fabSize};
  --fab-radius: ${fabRadius};
  --pulse-radius: ${pulseRadius};
  --hdr-bg: ${hdrBg};
  --font: ${ff};
  --win-hidden: ${winHidden};
  --win-visible: ${winVisible};
}

*{margin:0;padding:0;box-sizing:border-box;}

.zw{font-family:var(--font);font-size:${fontSize};line-height:1.5;position:fixed;bottom:${edgeMargin};${side}:${edgeMargin};z-index:2147483647;pointer-events:auto;isolation:isolate;}
/* Класс .zw-open ставится JS-ом при открытии — упрощает мобильные правила */
.zw.zw-open .zw-launcher-card{display:none!important;}

/* FAB */
.zw-fab{width:var(--fab-size);height:var(--fab-size);border-radius:var(--fab-radius);background:var(--fab-bg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:${fabShadow},0 0 0 1px rgba(255,255,255,0.15) inset;transition:transform .25s var(--ez-expo),box-shadow .25s var(--ez-expo);position:relative;${gt === "glass" ? "backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.3);" : ""}${gt === "animated" ? "background-size:400% 400%;animation:zw-gradient-shift 3s ease infinite;" : ""}}
.zw-fab:hover{transform:translateY(-2px);box-shadow:0 8px 30px var(--accent-40),0 0 0 1px rgba(255,255,255,0.2) inset;}
.zw-fab:active{transform:scale(0.97);}
.zw-fab svg{width:26px;height:26px;fill:#fff;filter:drop-shadow(0 1px 2px rgba(26,18,6,0.18));}
${gt === "animated" ? "@keyframes zw-gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}" : ""}
/* Пульс показываем ТОЛЬКО при непрочитанных (класс .has-unread ставит JS) */
.zw-fab-pulse{position:absolute;inset:-4px;border-radius:var(--pulse-radius);background:var(--accent-30);pointer-events:none;opacity:0;}
.zw-fab.has-unread .zw-fab-pulse{animation:zw-ping 2s ease infinite;}
${cfg.launcher_pulse === false ? ".zw-fab-pulse{display:none;}" : ""}
@keyframes zw-ping{0%{opacity:.5}75%,100%{transform:scale(1.4);opacity:0}}
.zw-badge{position:absolute;top:-6px;right:-6px;background:#c0392b;color:#fff;font-size:11px;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fffdf9;animation:zw-pop .3s var(--ez-back);}
@keyframes zw-pop{0%{transform:scale(0)}50%{transform:scale(1.3)}100%{transform:scale(1)}}

/* Launcher card */
.zw-launcher{position:absolute;bottom:0;${side}:0;display:flex;align-items:center;gap:12px;cursor:pointer;transition:all .2s;}
.zw-launcher-card{background:rgba(250,245,238,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:20px;padding:12px 18px 12px 14px;box-shadow:0 12px 32px rgba(26,18,6,0.12),0 1px 2px rgba(26,18,6,0.04);display:flex;align-items:center;gap:14px;border:1px solid #ede6dc;max-width:320px;margin-${side}:68px;transition:all .3s var(--ez-expo);position:relative;}
.zw-launcher-card:hover{box-shadow:0 16px 40px rgba(26,18,6,0.16);transform:translateY(-2px);}
.zw-launcher-ava{width:44px;height:44px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;box-shadow:0 2px 8px var(--accent-30);}
.zw-launcher-ava img{width:100%;height:100%;object-fit:cover;}
.zw-launcher-ava svg{width:22px;height:22px;fill:#fff;}
.zw-launcher-info{flex:1;min-width:0;padding-right:6px;}
.zw-launcher-text{font-size:14px;font-weight:700;color:#1a1206;line-height:1.3;}
.zw-launcher-sub{font-size:12px;color:#8c8072;margin-top:2px;line-height:1.2;}
.zw-launcher-close{width:22px;height:22px;border-radius:50%;background:#ede6dc;display:flex;align-items:center;justify-content:center;font-size:14px;color:#b5a99a;cursor:pointer;flex-shrink:0;transition:all .15s;font-weight:bold;margin-left:auto;}
.zw-launcher-close:hover{background:#e5ddd3;color:#5c5347;}

/* Icon+text launcher */
.zw-fab-text{display:flex;align-items:center;gap:8px;padding:0 20px 0 16px;width:auto;border-radius:28px;height:var(--fab-size);}
.zw-fab-text svg{width:22px;height:22px;}
.zw-fab-label{font-size:14px;font-weight:600;white-space:nowrap;color:#fff;}

/* Window */
.zw-win{position:absolute;bottom:68px;${side}:0;width:${winWidth};max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 100px);background:var(--bg);border-radius:20px;box-shadow:${winShadow};display:flex;flex-direction:column;overflow:hidden;${winHidden}transition:opacity .3s var(--ez-expo),transform .42s var(--ez-back);pointer-events:none;}
.zw-win.open{${winVisible}pointer-events:all;}

/* Header — по умолчанию светлый кремовый с блюром (header_style:"light"); акцентный — опция header_style:"accent" */
${hdrStyle === "accent" ? `
.zw-hdr{background:var(--hdr-bg);color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;position:relative;overflow:hidden;${gt === "animated" ? "background-size:400% 400%;animation:zw-gradient-shift 3s ease infinite;" : ""}}
.zw-hdr::after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.1) 0%,transparent 50%);pointer-events:none;}
.zw-hdr-ava{background:rgba(255,255,255,0.2);}
.zw-hdr-ava svg{fill:#fff;}
.zw-hdr-name{color:#fff;text-shadow:0 1px 2px rgba(26,18,6,0.12);}
.zw-hdr-st{color:#fff;opacity:0.9;}
.zw-hdr-resp{color:#fff;opacity:0.8;}
.zw-hdr-btn{background:rgba(255,255,255,0.15);}
.zw-hdr-btn:hover{background:rgba(255,255,255,0.25);}
.zw-hdr-btn svg{fill:#fff;}
` : `
.zw-hdr{background:rgba(250,245,238,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#1a1206;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;position:relative;border-bottom:1px solid #ede6dc;}
.zw-hdr-ava{background:#ede6dc;}
.zw-hdr-ava svg{fill:#8c8072;}
.zw-hdr-name{color:#1a1206;}
.zw-hdr-st{color:#8c8072;opacity:1;}
.zw-hdr-resp{color:#8c8072;opacity:1;}
.zw-hdr-btn{background:transparent;}
.zw-hdr-btn:hover{background:#ede6dc;}
.zw-hdr-btn svg{fill:#8c8072;}
`}
.zw-hdr-ava{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}
.zw-hdr-ava img{width:100%;height:100%;object-fit:cover;}
.zw-hdr-ava svg{width:22px;height:22px;}
.zw-hdr-info{flex:1;min-width:0;}
.zw-hdr-name{font-weight:700;font-size:15px;}
.zw-hdr-st{font-size:12px;display:flex;align-items:center;gap:6px;}
.zw-hdr-resp{font-size:11px;margin-top:2px;}
.zw-dot{width:7px;height:7px;border-radius:50%;background:#5b8c5a;flex-shrink:0;}
.zw-dot.wait{background:#e8960e;animation:zw-blink 1.5s infinite;}
.zw-dot.offline{background:#b5a99a;}
@keyframes zw-blink{0%,100%{opacity:1}50%{opacity:0.3}}
.zw-hdr-acts{display:flex;gap:6px;z-index:1;}
.zw-hdr-btn{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.zw-hdr-btn svg{width:16px;height:16px;}

/* Team avatars */
.zw-team{display:flex;align-items:center;}
${hdrStyle === "accent"
  ? ".zw-team-ava{border:2px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.2);color:#fff;}"
  : ".zw-team-ava{border:2px solid #faf5ee;background:#ede6dc;color:#7a4e32;}"}
.zw-team-ava{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:13px;font-weight:700;}
.zw-team-ava img{width:100%;height:100%;object-fit:cover;}
.zw-team-count{font-size:11px;opacity:0.85;margin-left:8px;}

/* Messages */
.zw-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:2px;background:var(--msgs-bg);}
.zw-date{text-align:center;padding:12px 0 8px;}
.zw-date span{background:var(--sys-bg);color:var(--sys-text);font-size:11px;font-weight:500;padding:4px 12px;border-radius:10px;}
.zw-row{display:flex;margin-bottom:6px;animation:zw-in .28s var(--ez-expo);}
.zw-row.v{justify-content:flex-end;}
.zw-row.o{justify-content:flex-start;}
@keyframes zw-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.zw-wrap{display:flex;align-items:flex-end;gap:8px;max-width:80%;}
.zw-row.v .zw-wrap{flex-direction:row-reverse;}
.zw-ava{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;overflow:hidden;}
.zw-ava.vv{background:linear-gradient(135deg,#e8530e,#f07b1f);}
.zw-ava.op{background:#ede6dc;color:#7a4e32;font-weight:700;}
.zw-ava.ai{background:linear-gradient(135deg,#b8860b,#d4a853);}
.zw-ava img{width:100%;height:100%;object-fit:cover;}
.zw-ava svg{width:14px;height:14px;fill:#fff;}
.zw-ava.op svg{fill:#7a4e32;}
.zw-bbl{border-radius:${bubbleR};overflow:hidden;max-width:100%;}
.zw-row.v .zw-bbl{background:linear-gradient(135deg,#e8530e,#f07b1f);color:#fff;border-bottom-right-radius:6px;}
.zw-row.o .zw-bbl{background:var(--op-bubble-bg);color:var(--text);border:1px solid var(--op-bubble-border);box-shadow:0 1px 2px rgba(26,18,6,0.05);border-bottom-left-radius:6px;}
.zw-sender{font-size:11px;font-weight:600;padding:8px 14px 0;}
.zw-sender.sop{color:#5b8c5a;}
.zw-sender.sai{color:#b8860b;}
.zw-txt{padding:6px 14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}
.zw-bbl.has-img .zw-txt{padding:4px 10px;}
.zw-img{padding:4px;cursor:pointer;}
.zw-img img{max-width:240px;max-height:180px;border-radius:14px;object-fit:cover;display:block;transition:opacity .15s;}
.zw-img img:hover{opacity:0.85;}
.zw-meta{display:flex;align-items:center;gap:4px;padding:0 14px 8px;}
.zw-bbl.has-img .zw-meta{padding:2px 10px 6px;}
.zw-row.v .zw-meta{justify-content:flex-end;}
.zw-time{font-size:10px;opacity:0.55;}
.zw-st svg{width:13px;height:13px;}
.zw-row.v .zw-st svg{fill:rgba(255,255,255,0.55);}
.zw-row.v .zw-st.rd svg{fill:rgba(255,255,255,0.9);}
.zw-sys{text-align:center;padding:8px 0;}
.zw-sys span{background:var(--sys-bg);color:var(--sys-text);font-size:12px;padding:6px 14px;border-radius:12px;display:inline-block;}

/* Reply quote */
.zw-reply{margin:6px 14px 0;padding:6px 10px;border-radius:8px;border-left:3px solid var(--accent);font-size:12px;line-height:1.3;}
.zw-row.v .zw-reply{background:rgba(255,255,255,0.15);border-left-color:rgba(255,255,255,0.5);}
.zw-row.o .zw-reply{background:var(--sys-bg);}
.zw-reply-sender{font-weight:700;font-size:11px;margin-bottom:2px;}
.zw-row.v .zw-reply-sender{color:rgba(255,255,255,0.85);}
.zw-row.o .zw-reply-sender{color:var(--accent);}
.zw-reply-text{opacity:0.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}

/* Quick replies */
.zw-qr{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 12px;}
.zw-qr-btn{padding:8px 14px;border-radius:999px;border:1px solid var(--op-bubble-border);background:var(--op-bubble-bg);color:#7a4e32;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;}
.zw-qr-btn:hover{border-color:var(--accent);background:var(--accent-08);color:var(--accent);}
.zw-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.zw-cbtn{padding:9px 14px;border-radius:999px;border:1px solid var(--op-bubble-border);background:var(--op-bubble-bg);color:#7a4e32;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;}
.zw-cbtn:hover{border-color:var(--accent);background:var(--accent-08);color:var(--accent);}
.zw-cbtn:disabled{opacity:.55;cursor:default;}
.zw-cbtn.pos{border-color:#5b8c5a;color:#5b8c5a;}
.zw-cbtn.pos:hover{background:rgba(91,140,90,0.1);color:#5b8c5a;}
.zw-cbtn.neg{border-color:#c0392b;color:#c0392b;}
.zw-cbtn.neg:hover{background:rgba(192,57,43,0.1);color:#c0392b;}
.zw-cards{display:flex;flex-direction:column;gap:10px;margin-top:8px;}
.zw-card{border:1px solid var(--op-bubble-border);border-radius:16px;overflow:hidden;background:var(--op-bubble-bg);box-shadow:0 1px 2px rgba(26,18,6,.04);transition:transform .2s var(--ez-expo),box-shadow .2s var(--ez-expo);}
.zw-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(26,18,6,.08);}
.zw-card-img{width:100%;height:130px;object-fit:cover;display:block;}
.zw-card-body{padding:11px 13px;}
.zw-card-title{font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;}
.zw-card-desc{font-size:13px;color:var(--text);opacity:.82;line-height:1.45;margin-bottom:9px;}
.zw-card-btns{display:flex;flex-wrap:wrap;gap:6px;}
.zw-guide-btn{border-style:dashed;font-weight:700;}

/* Typing */
.zw-typ{display:none;align-items:flex-end;gap:8px;margin-bottom:6px;}
.zw-typ.show{display:flex;}
.zw-typ-bbl{padding:12px 16px;background:var(--op-bubble-bg);border:1px solid var(--op-bubble-border);border-radius:18px;border-bottom-left-radius:6px;display:flex;align-items:center;gap:8px;box-shadow:0 1px 2px rgba(26,18,6,0.05);}
.zw-typ-dots{display:flex;gap:3px;}
.zw-typ-dots span{width:6px;height:6px;border-radius:50%;background:#b5a99a;animation:zw-bounce 1.2s infinite;}
.zw-typ-dots span:nth-child(2){animation-delay:.15s;}
.zw-typ-dots span:nth-child(3){animation-delay:.3s;}
@keyframes zw-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
.zw-typ-lbl{font-size:11px;color:#8c8072;}

/* Operator bar */
.zw-opbar{padding:8px 16px;border-top:1px solid var(--border);background:var(--bg);text-align:center;flex-shrink:0;}
.zw-opbar button{background:none;border:1px solid var(--border);cursor:pointer;color:var(--sys-text);font-size:13px;padding:8px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;transition:all .15s;font-family:inherit;}
.zw-opbar button:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-08);}
.zw-opbar button svg{width:15px;height:15px;fill:currentColor;}

/* Composer */
.zw-comp{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end;background:var(--input-bg);flex-shrink:0;min-width:0;}
.zw-att{width:36px;height:36px;border-radius:10px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.zw-att:hover{background:#ede6dc;}
.zw-att:disabled{opacity:0.4;cursor:default;}
.zw-att svg{width:18px;height:18px;fill:#8c8072;}
.zw-inp{flex:1;border:1px solid var(--input-border);border-radius:22px;padding:9px 16px;font-size:14px;font-family:inherit;resize:none;max-height:100px;outline:none;line-height:1.4;transition:all .15s;background:var(--input-bg);color:var(--text);box-shadow:0 2px 10px rgba(26,18,6,0.06);}
.zw-inp:focus{border-color:var(--accent-80);box-shadow:0 0 0 3px var(--accent-20);}
.zw-inp::placeholder{color:#b5a99a;}
.zw-snd-btn{width:36px;height:36px;border-radius:10px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.zw-snd-btn:hover{background:#ede6dc;}
.zw-snd-btn svg{width:17px;height:17px;fill:#8c8072;}
.zw-send{width:40px;height:40px;border-radius:50%;background:var(--send-bg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;box-shadow:0 2px 8px var(--accent-40);}
.zw-send:hover{box-shadow:0 4px 12px var(--accent-50);}
.zw-send:disabled{opacity:0.35;cursor:default;box-shadow:none;}
.zw-send{flex-shrink:0;}
.zw-send svg{width:17px;height:17px;fill:#fff;}

/* Prechat */
.zw-pre{padding:36px 26px 26px;display:flex;flex-direction:column;align-items:center;gap:18px;flex:1;overflow-y:auto;background:var(--msgs-bg);position:relative;}
.zw-pre::before{content:"";position:absolute;top:-10%;left:50%;transform:translateX(-50%);width:240px;height:240px;background:radial-gradient(circle, var(--accent-30) 0%, transparent 70%);pointer-events:none;opacity:0.6;}
.zw-pre-ava{width:72px;height:72px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 8px 28px var(--accent-40),0 0 0 4px rgba(255,255,255,0.5);overflow:hidden;position:relative;z-index:1;}
.zw-pre-ava img{width:100%;height:100%;object-fit:cover;}
.zw-pre-hi{font-size:22px;font-weight:800;color:var(--text);text-align:center;letter-spacing:-0.01em;position:relative;z-index:1;}
.zw-pre-desc{font-size:13px;color:var(--sys-text);text-align:center;margin-top:-10px;line-height:1.55;position:relative;z-index:1;max-width:280px;}
.zw-pre-fields{width:100%;display:flex;flex-direction:column;gap:14px;position:relative;z-index:1;}
.zw-field{width:100%;}
.zw-field label{font-size:12px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;text-transform:none;letter-spacing:0.01em;}
.zw-field .req{color:#c0392b;margin-left:3px;}
.zw-field input,.zw-field select,.zw-field textarea{width:100%;border:1.5px solid var(--border);border-radius:14px;padding:12px 16px;font-size:14px;font-family:inherit;outline:none;transition:border-color .18s,box-shadow .18s,background .18s;background:var(--input-bg);color:var(--text);}
.zw-field input:hover,.zw-field select:hover,.zw-field textarea:hover{border-color:var(--accent-50);}
.zw-field input:focus,.zw-field select:focus,.zw-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-18);}
.zw-field .err{border-color:#c0392b!important;box-shadow:0 0 0 4px rgba(192,57,43,0.12)!important;}
.zw-field .err-txt{color:#c0392b;font-size:11px;margin-top:6px;font-weight:600;}
.zw-pre-go{width:100%;background:var(--accent);color:#fff;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;transition:opacity .15s,box-shadow .25s,filter .15s;font-family:inherit;box-shadow:0 6px 20px var(--accent-40),0 0 0 1px rgba(255,255,255,0.18) inset;position:relative;z-index:1;}
.zw-pre-go:hover:not(:disabled){box-shadow:0 10px 30px var(--accent-50),0 0 0 1px rgba(255,255,255,0.25) inset;filter:brightness(1.06);}
.zw-pre-go:active:not(:disabled){transform:scale(0.98);}
.zw-pre-go:disabled{opacity:0.5;cursor:default;box-shadow:none;}

/* Rating */
.zw-rate{position:absolute;inset:0;background:rgba(255,255,255,0.97);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;z-index:10;backdrop-filter:blur(4px);animation:zw-fade .25s ease;}
@keyframes zw-fade{from{opacity:0}}
.zw-rate-title{font-size:18px;font-weight:700;color:var(--text);}
.zw-rate-sub{font-size:13px;color:var(--sys-text);text-align:center;margin-top:-8px;}
.zw-stars{display:flex;gap:6px;}
.zw-star{width:44px;height:44px;border:none;border-radius:12px;background:var(--bubble);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.zw-star:hover,.zw-star.active{background:#f5e6d3;transform:scale(1.1);}
.zw-star svg{width:24px;height:24px;fill:#d8cdbf;transition:fill .15s;}
.zw-star:hover svg,.zw-star.active svg{fill:#b8860b;}
.zw-rate-comment{width:100%;}
.zw-rate-comment textarea{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;outline:none;resize:none;height:80px;transition:all .15s;background:var(--input-bg);color:var(--text);}
.zw-rate-comment textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-18);}
.zw-rate-send{background:var(--accent);color:#fff;border:none;border-radius:12px;padding:12px 32px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit;}
.zw-rate-send:hover{opacity:0.9;}
.zw-rate-skip{background:none;border:none;color:#b5a99a;font-size:13px;cursor:pointer;margin-top:-4px;font-family:inherit;}
.zw-rate-skip:hover{color:#8c8072;}
.zw-rate-ok{text-align:center;}
.zw-rate-ok .emoji{font-size:48px;margin-bottom:12px;}
.zw-rate-ok .txt{font-size:16px;font-weight:600;color:var(--text);}
.zw-rate-ok .sub{font-size:13px;color:#8c8072;margin-top:4px;}

/* Greeting bubble */
.zw-greet{position:absolute;bottom:68px;${side}:0;background:var(--bg);border-radius:16px;padding:14px 18px;box-shadow:0 4px 24px rgba(26,18,6,0.12);max-width:260px;font-size:14px;color:var(--text);white-space:pre-wrap;cursor:pointer;opacity:0;transform:translateY(10px);transition:all .3s var(--ez-expo);pointer-events:none;line-height:1.5;border:1px solid var(--border);}
.zw-greet.show{opacity:1;transform:translateY(0);pointer-events:all;}
.zw-greet-x{position:absolute;top:6px;right:10px;background:none;border:none;cursor:pointer;font-size:16px;color:#b5a99a;line-height:1;}
.zw-greet-x:hover{color:#8c8072;}

/* Lightbox */
.zw-lb{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:16px;animation:zw-fade .2s ease;pointer-events:auto;}
.zw-lb img{max-width:90vw;max-height:90vh;border-radius:12px;object-fit:contain;cursor:default;}
.zw-lb-x{position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.zw-lb-x:hover{background:rgba(255,255,255,0.25);}
.zw-lb-x svg{width:20px;height:20px;fill:#fff;}

/* Spinner */
.zw-spin{animation:zw-sp .7s linear infinite;}
@keyframes zw-sp{to{transform:rotate(360deg)}}

/* Offline banner */
.zw-offline{padding:12px 16px;background:#f5e6d3;text-align:center;flex-shrink:0;border-top:1px solid #e8d5a8;}
.zw-offline-txt{font-size:13px;color:#7a4e32;font-weight:600;line-height:1.4;}

/* Invitation popup */
.zw-inv{position:absolute;bottom:68px;${side}:0;background:var(--bg);border-radius:20px;padding:0;box-shadow:0 8px 32px rgba(26,18,6,0.16);max-width:320px;width:calc(100vw - 48px);overflow:hidden;opacity:0;transform:translateY(12px);transition:all .3s var(--ez-expo);pointer-events:none;border:1px solid var(--border);}
.zw-inv.show{opacity:1;transform:translateY(0);pointer-events:all;}
.zw-inv-hdr{background:var(--hdr-bg);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px;${gt === "animated" ? "background-size:400% 400%;animation:zw-gradient-shift 3s ease infinite;" : ""}}
.zw-inv-ava{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}
.zw-inv-ava img{width:100%;height:100%;object-fit:cover;}
.zw-inv-ava svg{width:18px;height:18px;fill:#fff;}
.zw-inv-name{font-weight:700;font-size:14px;}
.zw-inv-body{padding:16px 18px;}
.zw-inv-msg{font-size:14px;color:var(--text);line-height:1.5;}
.zw-inv-acts{display:flex;gap:8px;padding:0 18px 16px;}
.zw-inv-accept{flex:1;padding:10px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s;}
.zw-inv-accept:hover{opacity:0.9;}
.zw-inv-decline{flex:1;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--sys-text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;}
.zw-inv-decline:hover{background:var(--bubble);}

/* Toasts (внутри виджета) */
.zw-toasts{position:absolute;left:0;right:0;top:74px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:5;}
.zw-toast{max-width:88%;padding:8px 14px;border-radius:14px;font-size:13px;font-weight:600;color:#fff;box-shadow:0 8px 22px rgba(26,18,6,0.18);opacity:0;transform:translateY(-8px);transition:all .25s var(--ez-expo);}
.zw-toast.show{opacity:1;transform:translateY(0);}
.zw-toast-success{background:#5b8c5a;}
.zw-toast-info{background:#8c7051;color:#fff;}
.zw-toast-error{background:#c0392b;}

/* Mobile (.zw-mobile) */
.zw.zw-mobile {
  position: fixed !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100vh !important;
  height: 100dvh !important;
  pointer-events: none !important;
  z-index: 2147483647 !important;
}
.zw.zw-mobile * {
  box-sizing: border-box !important;
}
.zw.zw-mobile .zw-win,
.zw.zw-mobile .zw-fab,
.zw.zw-mobile .zw-launcher-card,
.zw.zw-mobile .zw-greet,
.zw.zw-mobile .zw-inv,
.zw.zw-mobile .zw-mob-invite {
  pointer-events: auto !important;
}
.zw.zw-mobile .zw-fab {
  position: absolute !important;
  bottom: 16px !important;
  ${side}: 16px !important;
}
.zw.zw-mobile .zw-launcher-card {
  position: absolute !important;
  bottom: 16px !important;
  ${side}: 16px !important;
  margin: 0 !important;
  max-width: calc(100vw - 32px) !important;
  width: calc(100% - 32px) !important;
  display: ${(cfg.mobile_launcher_type === "card" || (cfg.mobile_launcher_type === "inherit" && cfg.launcher_type === "card")) ? "flex" : "none"} !important;
}
/* Когда чат открыт — скрываем ВСЕ launcher-элементы во всех мобильных режимах */
.zw.zw-mobile.zw-open .zw-fab,
.zw.zw-mobile.zw-open .zw-launcher-card,
.zw.zw-mobile.zw-open .zw-greet,
.zw.zw-mobile.zw-open .zw-mob-invite,
.zw.zw-mobile.zw-open .zw-inv {
  display: none !important;
  pointer-events: none !important;
}
/* Затемняющий backdrop позади мобильного окна */
.zw.zw-mobile.zw-open::before {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  background: rgba(26, 18, 6, 0.45) !important;
  z-index: 2147483646 !important;
  animation: zw-bd-in 0.25s ease !important;
  pointer-events: auto !important;
}
@keyframes zw-bd-in { from { opacity: 0; } to { opacity: 1; } }
${(() => {
  const mode = cfg.mobile_window_mode || "bottom_sheet";
  if (mode === "fullscreen") {
    return `
      .zw.zw-mobile .zw-win {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        max-width: 100vw !important;
        max-height: 100dvh !important;
        border-radius: 0 !important;
        z-index: 2147483647 !important;
        height: 100vh !important;
        height: 100svh !important;
        height: 100dvh !important;
        transform: translateY(100%) !important;
        opacity: 0 !important;
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease !important;
        pointer-events: none !important;
      }
      .zw.zw-mobile .zw-win.open {
        transform: translateY(0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;
  }
  if (mode === "bottom_sheet") {
    return `
      .zw.zw-mobile .zw-win {
        position: fixed !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        top: auto !important;
        width: 100vw !important;
        max-width: 100vw !important;
        /* Высота шторки. При открытой клавиатуре JS подставляет --zw-vvh (visualViewport). */
        height: var(--zw-vvh, 92dvh) !important;
        max-height: 92dvh !important;
        border-radius: 28px 28px 0 0 !important;
        box-shadow: 0 -10px 40px rgba(26,18,6,0.30) !important;
        z-index: 2147483647 !important;
        transform: translate3d(0, 100%, 0) !important;
        opacity: 0 !important;
        transition: transform 0.32s var(--ez-expo), opacity 0.2s ease !important;
        pointer-events: none !important;
        will-change: transform !important;
        backface-visibility: hidden !important;
        padding-bottom: env(safe-area-inset-bottom, 0px) !important;
      }
      .zw.zw-mobile .zw-win.open {
        transform: translate3d(0, 0, 0) !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      /* Во время свайпа по handle отключаем transition (JS ставит .zw-dragging) */
      .zw.zw-mobile .zw-win.zw-dragging {
        transition: none !important;
      }
      /* Handle сверху шторки — визуальная подсказка + зона свайпа-закрытия */
      .zw.zw-mobile .zw-win.open::after {
        content: "" !important;
        position: absolute !important;
        top: 8px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: 36px !important;
        height: 4px !important;
        background: rgba(26,18,6,0.15) !important;
        border-radius: 2px !important;
        z-index: 11 !important;
      }
    `;
  }
  // popup
  return `
    .zw.zw-mobile .zw-win {
      position: fixed !important;
      left: 8px !important;
      right: 8px !important;
      bottom: 80px !important;
      top: auto !important;
      width: auto !important;
      max-width: none !important;
      height: auto !important;
      max-height: 70vh !important;
      border-radius: 20px !important;
      z-index: 2147483647 !important;
      transform: scale(0.85) translateY(20px) !important;
      opacity: 0 !important;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease !important;
      pointer-events: none !important;
    }
    .zw.zw-mobile .zw-win.open {
      transform: scale(1) translateY(0) !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;
})()}
.zw.zw-mobile .zw-hdr {
  padding: 14px 16px !important;
  padding-top: max(14px, env(safe-area-inset-top, 0px)) !important;
  position: sticky !important;
  top: 0 !important;
  z-index: 10 !important;
  flex-shrink: 0 !important;
}
.zw.zw-mobile .zw-comp {
  padding: 10px 12px !important;
  padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)) !important;
  padding-right: max(12px, env(safe-area-inset-right, 0px)) !important;
  padding-left: max(12px, env(safe-area-inset-left, 0px)) !important;
  position: sticky !important;
  bottom: 0 !important;
  z-index: 10 !important;
  flex-shrink: 0 !important;
}
.zw.zw-mobile .zw-offline {
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)) !important;
  padding-right: max(16px, env(safe-area-inset-right, 0px)) !important;
  padding-left: max(16px, env(safe-area-inset-left, 0px)) !important;
}
.zw.zw-mobile .zw-msgs {
  flex: 1 !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch !important;
}
.zw.zw-mobile .zw-inp {
  font-size: 16px !important;
}

/* Мобильное приглашение поверх FAB */
.zw.zw-mobile .zw-mob-invite {
  position: absolute !important;
  bottom: calc(var(--fab-size) + 20px) !important;
  ${side}: 16px !important;
  background: #fff !important;
  color: #1a1206 !important;
  padding: 10px 14px !important;
  border-radius: 14px !important;
  box-shadow: 0 8px 24px rgba(26,18,6,0.18) !important;
  border: 1px solid #ede6dc !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  max-width: 220px !important;
  white-space: normal !important;
  cursor: pointer !important;
  animation: zw-mob-pop .35s var(--ez-expo) !important;
}
.zw.zw-mobile .zw-mob-invite::after {
  content: "" !important;
  position: absolute !important;
  bottom: -6px !important;
  ${side}: 24px !important;
  width: 12px !important;
  height: 12px !important;
  background: #fff !important;
  transform: rotate(45deg) !important;
  box-shadow: 2px 2px 4px rgba(26,18,6,0.06) !important;
}
.zw.zw-mobile .zw-mob-invite-x {
  position: absolute !important;
  top: -8px !important;
  ${isR ? "left" : "right"}: -8px !important;
  width: 22px !important;
  height: 22px !important;
  border-radius: 50% !important;
  background: #1a1206 !important;
  color: #fff !important;
  border: none !important;
  cursor: pointer !important;
  font-size: 12px !important;
  line-height: 1 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-shadow: 0 2px 6px rgba(26,18,6,0.2) !important;
}
@keyframes zw-mob-pop {
  from { opacity: 0; transform: scale(0.7) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
/* Уважаем системную настройку «уменьшить движение» — отключаем декоративные анимации */
@media (prefers-reduced-motion: reduce) {
  .zw-fab.has-unread .zw-fab-pulse{animation:none!important;}
  .zw-fab{animation:none!important;}
  .zw-typ-dots span{animation:none!important;}
  ${gt === "animated" ? ".zw-fab,.zw-hdr,.zw-inv-hdr{animation:none!important;background-size:auto!important;}" : ""}
  .zw-row{animation:none!important;}
}
${safeCss}`;
  }
  // ═══ RENDER ═══
  function render() {
    const cfg = state.config || {};

    // Save scroll state before destroying DOM contents
    const prevMsgs = shadow.getElementById("zw-msgs");
    let wasAtBottom = true;
    let prevScrollTop = 0;
    let prevScrollHeight = 0;
    if (prevMsgs) {
      prevScrollTop = prevMsgs.scrollTop;
      prevScrollHeight = prevMsgs.scrollHeight;
      wasAtBottom = (prevScrollHeight - prevScrollTop - prevMsgs.clientHeight) < 40;
    }

    // 1. Reuse or create Style tag
    let style = shadow.querySelector("style");
    if (!style) {
      style = document.createElement("style");
      shadow.appendChild(style);
    }
    const cssText = getCSS(cfg);
    if (style.textContent !== cssText) {
      style.textContent = cssText;
    }

    // Clean up existing lightbox if any before rendering a new one
    const existingLb = shadow.querySelector(".zw-lb");
    if (existingLb) shadow.removeChild(existingLb);
    if (state.lightboxUrl) renderLightbox();

    // Support container-based previewSize
    const isMobileViewport = (window.__zsPreviewConfig && window.__zsPreviewConfig.previewSize)
      ? (window.__zsPreviewConfig.previewSize === "mobile" || window.__zsPreviewConfig.previewSize === "tablet")
      : (window.innerWidth <= 480 || /Mobi|Android/i.test(navigator.userAgent));

    // 2. Reuse or create Root container
    let root = shadow.querySelector(".zw");
    if (!root) {
      root = document.createElement("div");
      root.setAttribute("role", "region");
      shadow.appendChild(root);
    }
    root.className = "zw" + (isMobileViewport ? " zw-mobile" : "") + (state.open ? " zw-open" : "");
    root.setAttribute("aria-label", cfg.header_title || "Онлайн-чат");
    state.refs.root = root;

    if (state.open && document.body && document.body.lastChild !== host) {
      try { document.body.appendChild(host); } catch(e) {}
    }

    // 3. Remove temporary elements from root so we can rebuild them, but KEEP 'win' and 'fab'
    const existingWin = shadow.querySelector(".zw-win");
    const existingFab = shadow.querySelector(".zw-fab");
    
    // Clear other children like greeting, launcher card, mob-invite, invitation
    Array.from(root.children).forEach(child => {
      if (child !== existingWin && child !== existingFab) {
        root.removeChild(child);
      }
    });

    // 4. Greeting (only for icon_only launcher)
    const mobileLT = cfg.mobile_launcher_type;
    const lt = (isMobileViewport && mobileLT && mobileLT !== "inherit")
      ? mobileLT
      : (cfg.launcher_type || "icon_only");
    // greet_once: флаг zs_greet_seen теперь ставится при закрытии/открытии (dismissGreet), а НЕ при показе.
    const greetSeen = cfg.greet_once === true && !window.__zsPreviewConfig && localStorage.getItem("zs_greet_seen") === "1";
    // greetDismissed персистится в sessionStorage — поллинг/сокеты больше не «перепоказывают» пузырь.
    if (!state.open && cfg.greeting && !state.prechatDone && lt === "icon_only" && !greetSeen && !state.greetDismissed) {
      const g = document.createElement("div");
      g.className = "zw-greet show";
      g.textContent = cfg.greeting;
      const gx = document.createElement("button");
      gx.className = "zw-greet-x";
      gx.textContent = "\u00d7";
      gx.setAttribute("aria-label", "Закрыть приветствие");
      gx.onclick = (e) => { e.stopPropagation(); g.classList.remove("show"); dismissGreet(); };
      g.appendChild(gx);
      g.onclick = () => { dismissGreet(); openChat(); scheduleRender(); };
      root.appendChild(g);
    }

    // 5. Launcher card
    const cardDismissed = state.cardDismissed;
    if (!state.open && lt === "card" && !cardDismissed) {
      const lc = document.createElement("div");
      lc.className = "zw-launcher-card";
      const lcAva = document.createElement("div");
      lcAva.className = "zw-launcher-ava";
      if (cfg.launcher_show_avatar !== false && cfg.avatar_url) {
        const avSrc = cfg.avatar_url.indexOf("http") === 0 ? cfg.avatar_url : API_BASE + cfg.avatar_url;
        lcAva.innerHTML = '<img src="' + esc(avSrc) + '" alt="Avatar">';
      } else {
        lcAva.innerHTML = IC.chat;
      }
      lc.appendChild(lcAva);
      const lcInfo = document.createElement("div");
      lcInfo.className = "zw-launcher-info";
      const lcText = document.createElement("div");
      lcText.className = "zw-launcher-text";
      lcText.textContent = cfg.launcher_text || "Нужна помощь?";
      lcInfo.appendChild(lcText);
      if (cfg.launcher_subtext) {
        const lcSub = document.createElement("div");
        lcSub.className = "zw-launcher-sub";
        lcSub.textContent = cfg.launcher_subtext;
        lcInfo.appendChild(lcSub);
      }
      lc.appendChild(lcInfo);
      const lcClose = document.createElement("div");
      lcClose.className = "zw-launcher-close";
      lcClose.textContent = "\u00d7";
      lcClose.onclick = (e) => {
        e.stopPropagation();
        state.cardDismissed = true;
        if (!window.__zsPreviewConfig) {
          try { sessionStorage.setItem("zs_card_dismissed", "1"); } catch(err) {}
        }
        scheduleRender();
      };
      lc.appendChild(lcClose);
      lc.onclick = (e) => {
        if (e.target === lcClose) return;
        openChat(); scheduleRender();
      };
      root.appendChild(lc);
    }

    // 6. Reuse or create Window
    let win = existingWin;
    if (!win) {
      win = document.createElement("div");
      win.setAttribute("role", "dialog");
      win.setAttribute("aria-modal", "true");
      state.refs.win = win;
    }
    // Update win
    win.className = "zw-win" + (state.open ? " open" : "");
    win.setAttribute("aria-label", cfg.header_title || "Онлайн-чат");
    win.innerHTML = ""; // rebuild inner contents safely

    win.appendChild(mkHeader(cfg));

    if (!state.prechatDone && state.prechat && state.prechat.enabled) {
      win.appendChild(mkPrechat(cfg));
    } else {
      win.appendChild(mkMessages(cfg));

      // Quick replies
      if (cfg.quick_replies_enabled && cfg.quick_replies?.length > 0) {
        const hasVisitorMsg = state.messages.some((m) => m.sender === "visitor");
        if (!hasVisitorMsg) {
          const qr = document.createElement("div");
          qr.className = "zw-qr";
          cfg.quick_replies.forEach((text) => {
            const btn = document.createElement("button");
            btn.className = "zw-qr-btn";
            btn.textContent = text;
            btn.onclick = () => {
              const inp = shadow.querySelector(".zw-inp");
              if (inp) { inp.value = text; doSend(inp); }
            };
            qr.appendChild(btn);
          });
          win.appendChild(qr);
        }
      }

      // Гид по продукции — показываем любому свежему посетителю,
      // пока он не начал писать живому оператору (или оператор не взял чат).
      if (!state.isOffline && state.session?.status !== "with_operator") {
        const hasBotControls = state.messages.some((m) => {
          let mm = m.metadata;
          if (typeof mm === "string") { try { mm = JSON.parse(mm); } catch (e) { mm = null; } }
          return mm && (mm.kind === "cards" || mm.kind === "buttons");
        });
        const hasVisitorMsg = state.messages.some((m) => m.sender === "visitor");
        if (!hasBotControls && !hasVisitorMsg) {
          const guide = document.createElement("div");
          guide.className = "zw-qr";
          const gb = document.createElement("button");
          gb.className = "zw-qr-btn zw-guide-btn";
          gb.textContent = "✨ Ознакомиться с продукцией";
          gb.onclick = () => { gb.disabled = true; startProductGuide(); };
          guide.appendChild(gb);
          win.appendChild(guide);
        }
      }

      if (state.isOffline) {
        win.appendChild(mkOfflineBanner());
      }

      if (state.session?.status === "ai" && !state.isOffline) {
        win.appendChild(mkOpBar(cfg));
      }

      // Composer logic
      const offMode = cfg.offline_mode || "message_only";
      if (state.isOffline && (offMode === "email_capture" || offMode === "callback_request" || offMode === "redirect")) {
        // no composer
      } else {
        win.appendChild(mkComposer(cfg));
      }
    }

    if (state.showRating) {
      win.appendChild(mkRating(cfg));
    }

    // Append win if not already in root
    if (!root.contains(win)) {
      root.appendChild(win);
    }

    // 7. Reuse or create FAB
    let fab = existingFab;
    if (!fab) {
      fab = document.createElement("button");
      state.refs.fab = fab;
    }
    // Rebuild fab contents
    fab.innerHTML = "";
    fab.setAttribute("aria-label", state.open ? "Закрыть чат" : "Открыть чат");

    const icon = IC[cfg.button_icon] || IC.chat;
    const isCardVisible = !state.open && lt === "card" && !cardDismissed;
    if (isCardVisible) {
      fab.style.display = "none";
    } else {
      fab.style.display = "flex";
      // .has-unread включает пульс только при наличии непрочитанных (см. CSS)
      const unreadCls = (state.unread > 0 && !state.open) ? " has-unread" : "";
      if (!state.open && (lt === "icon_text" || lt === "text_only")) {
        fab.className = "zw-fab zw-fab-text" + unreadCls;
        if (lt !== "text_only") fab.innerHTML = icon;
        const lbl = document.createElement("span");
        lbl.className = "zw-fab-label";
        lbl.textContent = cfg.launcher_text || cfg.button_text || "Помощь";
        fab.appendChild(lbl);
      } else {
        fab.className = "zw-fab" + unreadCls;
        fab.innerHTML = state.open ? IC.close : icon;
      }
    }

    if (!state.open && cfg.launcher_pulse !== false && lt === "icon_only") {
      const pulse = document.createElement("span");
      pulse.className = "zw-fab-pulse";
      fab.appendChild(pulse);
    }

    if (state.unread > 0 && !state.open && !cfg.hide_unread_badge && !(isMobileViewport && cfg.mobile_hide_unread_badge)) {
      const badge = document.createElement("span");
      badge.className = "zw-badge";
      badge.textContent = state.unread > 9 ? "9+" : String(state.unread);
      badge.setAttribute("aria-label", state.unread + " непрочитанных");
      fab.appendChild(badge);
      state.refs.badge = badge;
    } else {
      state.refs.badge = null;
    }

    fab.onclick = () => {
      if (state.open) {
        closeChat();
        if (cfg.remember_open_state !== false) {
          try { localStorage.setItem("zs_widget_open", "0"); } catch (e) { /* ignore */ }
        }
      } else { openChat(); }
      scheduleRender();
    };

    // Append fab if not already in root
    if (!root.contains(fab)) {
      root.appendChild(fab);
    }

    // 8. Invitation popup
    if (state.pendingInvitation && !state.open) {
      root.appendChild(mkInvitation(state.pendingInvitation));
    }

    // 9. Мобильное мини-приглашение поверх FAB
    if (isMobileViewport && !state.open && lt !== "card" && cfg.mobile_invitation_enabled !== false && !state.mobileInviteDismissed && state.mobileInviteShown) {
      const inv = document.createElement("div");
      inv.className = "zw-mob-invite";
      inv.textContent = cfg.mobile_invitation_text || "Нужна помощь? Нажмите!";
      const x = document.createElement("button");
      x.className = "zw-mob-invite-x";
      x.type = "button";
      x.setAttribute("aria-label", "Закрыть подсказку");
      x.textContent = "×";
      x.onclick = (e) => {
        e.stopPropagation();
        dismissMobInvite();
        scheduleRender();
      };
      inv.appendChild(x);
      inv.onclick = (e) => {
        if (e.target === x) return;
        dismissMobInvite();
        openChat();
        scheduleRender();
      };
      root.appendChild(inv);
    }

    // Restore scroll
    if (state.open && state.prechatDone) {
      const newMsgs = shadow.getElementById("zw-msgs");
      if (newMsgs) {
        if (wasAtBottom || prevScrollHeight === 0) {
          newMsgs.scrollTop = newMsgs.scrollHeight;
        } else {
          newMsgs.scrollTop = prevScrollTop;
        }
        // Когда картинки в сообщениях догрузились — они меняют высоту,
        // поэтому повторно скроллим вниз если до этого были внизу.
        if (wasAtBottom || prevScrollHeight === 0) {
          const imgs = newMsgs.querySelectorAll("img");
          imgs.forEach((img) => {
            if (!img.complete) {
              img.addEventListener("load", () => {
                // Только если пользователь не отскроллил вверх вручную
                const distFromBottom = newMsgs.scrollHeight - newMsgs.scrollTop - newMsgs.clientHeight;
                if (distFromBottom < 200) newMsgs.scrollTop = newMsgs.scrollHeight;
              }, { once: true });
            }
          });
        }
      }
    }

    // Focus trap on open
    if (state.open) {
      const firstFocus = shadow.querySelector(".zw-inp") || shadow.querySelector(".zw-hdr-btn");
      if (firstFocus) setTimeout(() => firstFocus.focus(), 100);
    }
    // visualViewport handler намеренно НЕ используем — он вызывал «прыжки» при
    // появлении/исчезновении клавиатуры. Вместо него полагаемся на `100dvh`
    // в CSS (dynamic viewport height) — современные браузеры (iOS 15.4+, Android
    // Chrome 108+) автоматически учитывают клавиатуру.
    // Подчищаем старые подписки, если были.
    if (window.visualViewport && state._lastApplyVV) {
      try {
        window.visualViewport.removeEventListener("resize", state._lastApplyVV);
        window.visualViewport.removeEventListener("scroll", state._lastApplyVV);
      } catch(e) {}
      state._lastApplyVV = null;
    }
  }

  // Lock/unlock скролла body на мобильном (чтобы сайт не съезжал за шторкой)
  function lockBodyScroll() {
    // НЕ используем position:fixed — это вызывает «прыжки» (страница телепортируется).
    // Используем overflow:hidden на html — мягче и сохраняет scroll-позицию.
    try {
      const mobileOpen = window.innerWidth <= 480 || /Mobi|Android/i.test(navigator.userAgent);
      if (mobileOpen && document.documentElement && !document.documentElement.dataset.zsLocked) {
        document.documentElement.dataset.zsLocked = "1";
        document.documentElement.dataset.zsPrevOverflow = document.documentElement.style.overflow || "";
        document.documentElement.style.overflow = "hidden";
        // Дополнительно фиксируем touchmove на body чтобы остановить iOS rubber-band scroll
        document.body && document.body.addEventListener("touchmove", preventTouchMove, { passive: false });
      }
    } catch (e) { /* ignore */ }
  }
  function preventTouchMove(e) {
    // Разрешаем скролл внутри виджета (Shadow DOM), блокируем за его пределами.
    const path = e.composedPath ? e.composedPath() : [];
    const inWidget = path.some((node) => node === host);
    if (!inWidget) {
      try { e.preventDefault(); } catch (_) { /* ignore */ }
    }
  }
  function unlockBodyScroll() {
    try {
      if (document.documentElement && document.documentElement.dataset.zsLocked === "1") {
        document.documentElement.style.overflow = document.documentElement.dataset.zsPrevOverflow || "";
        delete document.documentElement.dataset.zsLocked;
        delete document.documentElement.dataset.zsPrevOverflow;
        document.body && document.body.removeEventListener("touchmove", preventTouchMove);
      }
    } catch (e) { /* ignore */ }
  }
  // Помечаем приветственный пузырь закрытым (память + sessionStorage), один раз на вкладку.
  // Здесь же фиксируем greet_once (zs_greet_seen) — теперь только при закрытии/открытии, а не при показе.
  function dismissGreet() {
    state.greetDismissed = true;
    if (!window.__zsPreviewConfig) {
      try { sessionStorage.setItem("zs_greet_dismissed", "1"); } catch (e) { /* ignore */ }
      const cfg = state.config || {};
      if (cfg.greet_once === true) {
        try { localStorage.setItem("zs_greet_seen", "1"); } catch (e) { /* ignore */ }
      }
    }
  }

  // Мобильный тизер: закрытие персистим в sessionStorage — один раз на вкладку.
  function dismissMobInvite() {
    state.mobileInviteDismissed = true;
    if (!window.__zsPreviewConfig) {
      try { sessionStorage.setItem("zs_mobinvite_dismissed", "1"); } catch (e) { /* ignore */ }
    }
  }

  function closeChat() {
    state.open = false;
    unlockBodyScroll();
    if (typeof state._applyVVH === "function") { try { state._applyVVH(); } catch (e) {} }
  }

  function openChat() {
    state.open = true;
    state.unread = 0;
    dismissGreet();
    markVisibleAsRead();

    // Перемещаем хост на самый верх дерева DOM, чтобы z-index работал безотказно
    if (document.body && document.body.lastChild !== host) {
      try { document.body.appendChild(host); } catch(e) {}
    }

    lockBodyScroll();

    const cfg = state.config || {};
    if (cfg.remember_open_state !== false && !window.__zsPreviewConfig) {
      try { localStorage.setItem("zs_widget_open", "1"); } catch (e) { /* ignore */ }
    }
    // Сброс таймера авто-сворачивания
    if (state._autoMinTimer) { clearTimeout(state._autoMinTimer); state._autoMinTimer = null; }
    if ((cfg.auto_minimize_after || 0) > 0) {
      state._autoMinTimer = setTimeout(() => {
        closeChat();
        scheduleRender();
      }, cfg.auto_minimize_after * 1000);
    }
    if (cfg._ab_variant && !state._abTrackedOpen) {
      state._abTrackedOpen = true;
      api("POST", "/api/widget/ab-track", { variant: cfg._ab_variant, event: "opened", visitor_id: state.visitorId });
    }

    // Пересчёт высоты мобильной шторки под текущую видимую область (клавиатура и т.п.)
    if (typeof state._applyVVH === "function") {
      requestAnimationFrame(() => { try { state._applyVVH(); } catch (e) {} });
    }

    // При открытии чата с историей — гарантированно проскроллить вниз к последнему сообщению.
    // Делаем несколько вызовов: сразу, после рендера, после загрузки картинок.
    requestAnimationFrame(() => scrollBottom(true));
    setTimeout(() => scrollBottom(true), 50);
    setTimeout(() => scrollBottom(true), 200);
    setTimeout(() => scrollBottom(true), 500);
  }

  function scrollBottom(force) {
    const el = shadow.getElementById("zw-msgs");
    if (!el) return;
    if (force) {
      // принудительно — без анимации
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  function updateTypingIndicator() {
    const typ = shadow.querySelector(".zw-typ");
    if (typ) {
      typ.classList.toggle("show", state.typing);
      const msgs = shadow.getElementById("zw-msgs");
      if (msgs) {
        const atBottom = (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight) < 60;
        if (atBottom) msgs.scrollTop = msgs.scrollHeight;
      }
    } else {
      scheduleRender();
    }
  }

  // ═══ HEADER ═══
  function mkHeader(cfg) {
    const h = document.createElement("div");
    h.className = "zw-hdr";

    // Team avatars (only when online)
    if (cfg.team_mode && state.teamOperators?.length > 0 && !state.isOffline) {
      const teamW = document.createElement("div");
      teamW.className = "zw-team";
      const maxAva = cfg.team_avatars_count || 3;
      state.teamOperators.slice(0, maxAva).forEach((op, i) => {
        const ta = document.createElement("div");
        ta.className = "zw-team-ava";
        ta.style.marginLeft = i > 0 ? "-8px" : "0";
        ta.style.zIndex = String(10 - i);
        if (op.avatar_url) {
          ta.innerHTML = '<img src="' + esc(API_BASE + op.avatar_url) + '" alt="' + esc(op.name || "Оператор") + '">';
        } else {
          ta.textContent = (op.name || "O")[0].toUpperCase();
        }
        teamW.appendChild(ta);
      });
      h.appendChild(teamW);
    } else if (cfg.show_operator_avatar !== false) {
      const ava = document.createElement("div");
      ava.className = "zw-hdr-ava";
      const s = state.session;
      if (s?.status === "with_operator" && s.operator_avatar_url) {
        ava.innerHTML = '<img src="' + esc(API_BASE + s.operator_avatar_url) + '" alt="Оператор">';
      } else if (cfg.avatar_url) {
        const avSrc = cfg.avatar_url.indexOf("http") === 0 ? cfg.avatar_url : API_BASE + cfg.avatar_url;
        ava.innerHTML = '<img src="' + esc(avSrc) + '" alt="Avatar">';
      } else {
        ava.innerHTML = IC.person;
      }
      h.appendChild(ava);
    }

    const info = document.createElement("div");
    info.className = "zw-hdr-info";

    const name = document.createElement("div");
    name.className = "zw-hdr-name";
    state.refs.headerName = name;
    const s2 = state.session;

    if (state.isOffline) {
      name.textContent = cfg.header_title || "Мы офлайн";
    } else if (cfg.team_mode) {
      name.textContent = cfg.team_label || "Команда поддержки";
    } else if (s2?.status === "with_operator") {
      name.textContent = cfg.show_operator_name !== false ? (s2.operator_name || "Оператор") : "Оператор";
    } else if (s2?.status === "waiting_operator") {
      name.textContent = "Ожидание...";
    } else {
      name.textContent = cfg.header_title || "Онлайн-чат";
    }
    info.appendChild(name);

    const st = document.createElement("div");
    st.className = "zw-hdr-st";
    state.refs.headerSt = st;
    const dot = document.createElement("span");
    dot.className = "zw-dot";
    state.refs.headerDot = dot;

    if (state.isOffline) {
      dot.classList.add("offline");
      st.appendChild(dot);
      st.appendChild(document.createTextNode("Офлайн"));
    } else if (cfg.team_mode && state.teamOperators) {
      st.appendChild(dot);
      const teamText = (cfg.team_online_text || "{n} онлайн").replace("{n}", state.teamOperators.length);
      st.appendChild(document.createTextNode(teamText));
    } else if (s2?.status === "waiting_operator") {
      dot.classList.add("wait");
      st.appendChild(dot);
      st.appendChild(document.createTextNode("Подключаем оператора"));
    } else if (s2?.status === "with_operator") {
      st.appendChild(dot);
      st.appendChild(document.createTextNode("Онлайн"));
    } else if (state.connected) {
      st.appendChild(dot);
      st.appendChild(document.createTextNode("Онлайн"));
    } else {
      dot.classList.add("offline");
      st.appendChild(dot);
      st.appendChild(document.createTextNode("Подключение..."));
    }
    info.appendChild(st);

    // Response time label
    if (cfg.response_time_enabled && cfg.response_time_label) {
      const resp = document.createElement("div");
      resp.className = "zw-hdr-resp";
      resp.textContent = cfg.response_time_label;
      info.appendChild(resp);
    }

    h.appendChild(info);

    const acts = document.createElement("div");
    acts.className = "zw-hdr-acts";
    const closeBtn = document.createElement("button");
    closeBtn.className = "zw-hdr-btn";
    closeBtn.innerHTML = IC.close;
    closeBtn.setAttribute("aria-label", "Закрыть чат");
    closeBtn.onclick = () => { closeChat(); scheduleRender(); };
    acts.appendChild(closeBtn);
    h.appendChild(acts);

    return h;
  }
  // ═══ PRECHAT ═══
  function mkPrechat(cfg) {
    const fields = state.prechat?.fields || [];
    const c = document.createElement("div");
    c.className = "zw-pre";

    const ava = document.createElement("div");
    ava.className = "zw-pre-ava";
    if (cfg.avatar_url) {
      const avSrc = cfg.avatar_url.indexOf("http") === 0 ? cfg.avatar_url : API_BASE + cfg.avatar_url;
      ava.innerHTML = '<img src="' + esc(avSrc) + '" alt="Avatar">';
    } else {
      ava.textContent = "\uD83D\uDCAC";
    }
    c.appendChild(ava);

    const hi = document.createElement("div");
    hi.className = "zw-pre-hi";
    hi.textContent = cfg.header_title || "Онлайн-чат";
    c.appendChild(hi);

    if (cfg.greeting) {
      const desc = document.createElement("div");
      desc.className = "zw-pre-desc";
      desc.textContent = cfg.greeting;
      c.appendChild(desc);
    }

    const inputs = {};
    const fieldsWrap = document.createElement("div");
    fieldsWrap.className = "zw-pre-fields";

    const allFields = fields.length > 0 ? fields : [{ name: "name", type: "text", label: "Как вас зовут?", required: true }];

    allFields.forEach((f) => {
      const wrap = document.createElement("div");
      wrap.className = "zw-field";

      const label = document.createElement("label");
      label.textContent = f.label;
      if (f.required) { label.innerHTML += '<span class="req">*</span>'; }
      wrap.appendChild(label);

      let inp;
      if (f.type === "select" && f.options) {
        inp = document.createElement("select");
        const empty = document.createElement("option");
        empty.value = ""; empty.textContent = "Выберите...";
        inp.appendChild(empty);
        f.options.forEach((o) => {
          const opt = document.createElement("option");
          opt.value = o; opt.textContent = o;
          inp.appendChild(opt);
        });
      } else if (f.type === "textarea") {
        inp = document.createElement("textarea");
        inp.rows = 3;
      } else {
        inp = document.createElement("input");
        inp.type = f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text";
      }
      inp.placeholder = f.placeholder || f.label;
      inp.setAttribute("aria-label", f.label);
      if (f.name === "name" && state.visitorName) inp.value = state.visitorName;
      if (state.prechatDrafts && state.prechatDrafts[f.name] !== undefined) {
        inp.value = state.prechatDrafts[f.name];
      }
      inp.oninput = () => {
        if (!state.prechatDrafts) state.prechatDrafts = {};
        state.prechatDrafts[f.name] = inp.value;
      };
      inputs[f.name] = inp;
      wrap.appendChild(inp);
      fieldsWrap.appendChild(wrap);
    });

    c.appendChild(fieldsWrap);

    const btn = document.createElement("button");
    btn.className = "zw-pre-go";
    btn.textContent = "Начать чат";

    const doSubmit = () => {
      let ok = true;
      allFields.forEach((f) => {
        const inp = inputs[f.name];
        if (!inp) return;
        const val = inp.value.trim();
        inp.classList.remove("err");
        const old = inp.parentNode.querySelector(".err-txt");
        if (old) old.remove();

        if (f.required && !val) {
          inp.classList.add("err");
          const e = document.createElement("div");
          e.className = "err-txt"; e.textContent = "Обязательное поле";
          inp.parentNode.appendChild(e); ok = false;
        }
        if (f.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          inp.classList.add("err");
          const e2 = document.createElement("div");
          e2.className = "err-txt"; e2.textContent = "Некорректный email";
          inp.parentNode.appendChild(e2); ok = false;
        }
      });

      if (!ok) return;

      state.prechatDrafts = {};

      if (inputs.name) {
        state.visitorName = inputs.name.value.trim();
        localStorage.setItem("zs_visitor_name", state.visitorName);
      }

      state.prechatDone = true;
      localStorage.setItem("zs_prechat_done", "1");

      const fd = {};
      Object.keys(inputs).forEach((k) => { fd[k] = inputs[k].value.trim(); });

      startSession(fd);
      scheduleRender();
    };

    btn.onclick = doSubmit;
    Object.keys(inputs).forEach((k) => {
      inputs[k].addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); doSubmit(); }
      });
    });

    c.appendChild(btn);
    return c;
  }

  // ═══ MESSAGES ═══
  function mkMessages(cfg) {
    const c = document.createElement("div");
    c.className = "zw-msgs";
    c.id = "zw-msgs";
    c.setAttribute("role", "log");
    c.setAttribute("aria-live", "polite");
    c.setAttribute("aria-label", "Сообщения чата");
    state.refs.msgs = c;

    let lastDate = "";

    state.messages.forEach((msg) => {
      const d = new Date(msg.created_at).toLocaleDateString("ru-RU");
      if (d !== lastDate) {
        lastDate = d;
        const today = new Date().toLocaleDateString("ru-RU");
        const yest = new Date(Date.now() - 86400000).toLocaleDateString("ru-RU");
        const lbl = d === today ? "Сегодня" : d === yest ? "Вчера" : d;
        const sep = document.createElement("div");
        sep.className = "zw-date";
        sep.innerHTML = "<span>" + esc(lbl) + "</span>";
        c.appendChild(sep);
      }

      if (msg.sender === "system") {
        const sys = document.createElement("div");
        sys.className = "zw-sys";
        sys.setAttribute("role", "status");
        sys.innerHTML = "<span>" + esc(msg.message) + "</span>";
        c.appendChild(sys);
        return;
      }

      const isV = msg.sender === "visitor";
      const imgUrl = getMsgImg(msg);
      const hasImg = !!imgUrl;
      const showTxt = !hasImg || (msg.message && msg.message !== imgUrl && msg.message !== "[Изображение]" && msg.message !== "\uD83D\uDCF7 [Изображение]");

      const row = document.createElement("div");
      row.className = "zw-row " + (isV ? "v" : "o");

      const wrap = document.createElement("div");
      wrap.className = "zw-wrap";

      const ava = document.createElement("div");
      if (isV) {
        ava.className = "zw-ava vv";
        ava.innerHTML = IC.person;
      } else if (msg.sender === "operator") {
        ava.className = "zw-ava op";
        if (state.session?.operator_avatar_url) {
          ava.innerHTML = '<img src="' + esc(API_BASE + state.session.operator_avatar_url) + '" alt="Оператор">';
        } else {
          ava.textContent = "\uD83D\uDC68\u200D\uD83D\uDCBC";
        }
      } else {
        ava.className = "zw-ava ai";
        ava.textContent = "\uD83E\uDD16";
      }
      wrap.appendChild(ava);

      const bbl = document.createElement("div");
      bbl.className = "zw-bbl" + (hasImg ? " has-img" : "");
      bbl.setAttribute("role", "article");
      bbl.setAttribute("aria-label", (isV ? "Ваше" : "Входящее") + " сообщение в " + fmtTime(msg.created_at));

      if (!isV) {
        const snd = document.createElement("div");
        snd.className = "zw-sender " + (msg.sender === "operator" ? "sop" : "sai");
        snd.textContent = msg.sender === "ai" ? "AI-бот" : (state.session?.operator_name || "Оператор");
        bbl.appendChild(snd);
      }

      // Reply quote
      if (msg.reply_to_id || msg.reply_to) {
        const replyId = msg.reply_to_id || msg.reply_to;
        const replyMsg = state.messages.find((m) => m.id === replyId);
        if (replyMsg) {
          const quote = document.createElement("div");
          quote.className = "zw-reply";
          const qSender = document.createElement("div");
          qSender.className = "zw-reply-sender";
          qSender.textContent = replyMsg.sender === "visitor" ? "Вы" : replyMsg.sender === "ai" ? "AI-бот" : (state.session?.operator_name || "Оператор");
          quote.appendChild(qSender);
          const qText = document.createElement("div");
          qText.className = "zw-reply-text";
          const replyTxt = replyMsg.message || "";
          qText.textContent = replyTxt.length > 80 ? replyTxt.substring(0, 80) + "…" : replyTxt;
          quote.appendChild(qText);
          bbl.appendChild(quote);
        }
      }

      if (hasImg) {
        const imgW = document.createElement("div");
        imgW.className = "zw-img";
        const img = document.createElement("img");
        img.src = imgUrl; img.alt = "Изображение"; img.loading = "lazy";
        img.onclick = () => openLightbox(imgUrl);
        imgW.appendChild(img);
        bbl.appendChild(imgW);
      }

      const isDeleted = msg.is_deleted || msg.message_type === "deleted" || !!msg.deleted_at;

      if (isDeleted) {
        const txt = document.createElement("div");
        txt.className = "zw-txt zw-txt-deleted";
        txt.innerHTML = "<i>🚫 Сообщение удалено</i>";
        txt.style.cssText = "opacity:0.5;font-style:italic;";
        bbl.appendChild(txt);
      } else if (showTxt) {
        const txt = document.createElement("div");
        txt.className = "zw-txt";
        txt.innerHTML = parseMarkdown(msg.message);
        bbl.appendChild(txt);
      }

      // Бот: кнопки / карточки из metadata (виджет-бот)
      var _md = msg.metadata;
      if (typeof _md === "string") { try { _md = JSON.parse(_md); } catch (e) { _md = null; } }
      if (!isV && _md && typeof _md === "object") {
        if (_md.kind === "cards" && Array.isArray(_md.cards)) {
          const cardsW = document.createElement("div");
          cardsW.className = "zw-cards";
          _md.cards.forEach((card) => {
            const cd = document.createElement("div");
            cd.className = "zw-card";
            if (card.image) {
              const im = document.createElement("img");
              im.className = "zw-card-img"; im.loading = "lazy"; im.src = card.image; im.alt = card.title || "";
              cd.appendChild(im);
            }
            const cbody = document.createElement("div");
            cbody.className = "zw-card-body";
            if (card.title) { const tt = document.createElement("div"); tt.className = "zw-card-title"; tt.textContent = card.title; cbody.appendChild(tt); }
            if (card.description) { const dd = document.createElement("div"); dd.className = "zw-card-desc"; dd.textContent = card.description; cbody.appendChild(dd); }
            if (Array.isArray(card.buttons) && card.buttons.length) {
              const cbw = document.createElement("div"); cbw.className = "zw-card-btns";
              card.buttons.forEach((b) => cbw.appendChild(makeBotBtn(b, _md.node)));
              cbody.appendChild(cbw);
            }
            cd.appendChild(cbody);
            cardsW.appendChild(cd);
          });
          bbl.appendChild(cardsW);
        } else if (_md.kind === "buttons" && Array.isArray(_md.buttons)) {
          const bw = document.createElement("div"); bw.className = "zw-btns";
          _md.buttons.forEach((b) => bw.appendChild(makeBotBtn(b, _md.node)));
          bbl.appendChild(bw);
        }
      }

      const meta = document.createElement("div");
      meta.className = "zw-meta";

      if (msg.updated_at && new Date(msg.updated_at).getTime() - new Date(msg.created_at).getTime() > 5000) {
        const edited = document.createElement("span");
        edited.className = "zw-edited";
        edited.textContent = "(ред.) ";
        edited.style.cssText = "font-size:10px;opacity:0.6;margin-right:4px;";
        meta.appendChild(edited);
      }

      const time = document.createElement("span");
      time.className = "zw-time";
      time.textContent = fmtTime(msg.created_at);
      meta.appendChild(time);

      if (isV) {
        const stEl = document.createElement("span");
        stEl.className = "zw-st";
        if (msg.status === "read") { stEl.classList.add("rd"); stEl.innerHTML = IC.checkDbl; }
        else if (msg.status === "delivered") { stEl.innerHTML = IC.checkDbl; }
        else { stEl.innerHTML = IC.check; }
        meta.appendChild(stEl);
      }
      if (msg.reactions && msg.reactions.length > 0) {
        var reactWrap = document.createElement("div");
        reactWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;padding:2px 14px 4px;";
        var grouped = {};
        msg.reactions.forEach(function(r) {
          if (!grouped[r.emoji]) grouped[r.emoji] = [];
          grouped[r.emoji].push(r.operator_name || "Оператор");
        });
        Object.keys(grouped).forEach(function(emoji) {
          var chip = document.createElement("span");
          chip.style.cssText = "display:inline-flex;align-items:center;gap:2px;padding:2px 8px;border-radius:12px;font-size:13px;cursor:default;" +
            (isV ? "background:rgba(255,255,255,0.2);" : "background:var(--sys-bg);");
          chip.textContent = emoji + " " + grouped[emoji].length;
          chip.title = grouped[emoji].join(", ");
          reactWrap.appendChild(chip);
        });
        bbl.appendChild(reactWrap);
      }

      bbl.appendChild(meta);
      wrap.appendChild(bbl);
      row.appendChild(wrap);
      c.appendChild(row);
    });

    // Offline Lead Form (Task 30)
    if (state.showOfflineLeadForm && !state.offlineFormSent) {
      const formRow = document.createElement("div");
      formRow.className = "zw-row o";

      const formWrap = document.createElement("div");
      formWrap.className = "zw-wrap";
      formWrap.style.cssText = "max-width: 90%; margin-top: 8px;";

      const botAva = document.createElement("div");
      botAva.className = "zw-ava ai";
      botAva.textContent = "🤖";
      formWrap.appendChild(botAva);

      const formBbl = document.createElement("div");
      formBbl.className = "zw-bbl";
      formBbl.style.cssText = "background:var(--bg);border:1px solid var(--border);box-shadow:0 4px 12px rgba(26,18,6,0.08);border-bottom-left-radius:6px;width:100%;";

      const formHeader = document.createElement("div");
      formHeader.className = "zw-sender sai";
      formHeader.textContent = "Форма обратной связи";
      formBbl.appendChild(formHeader);

      const formContainer = document.createElement("div");
      formContainer.style.cssText = "padding: 12px 14px;";

      const inputStyle = "width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;margin-bottom:8px;outline:none;font-family:inherit;background:var(--input-bg);color:var(--text);";

      const nameInp = document.createElement("input");
      nameInp.placeholder = "Ваше имя";
      nameInp.style.cssText = inputStyle;
      if (state.visitorName) nameInp.value = state.visitorName;
      formContainer.appendChild(nameInp);

      const contactInp = document.createElement("input");
      contactInp.placeholder = "Email или Телефон";
      contactInp.style.cssText = inputStyle;
      formContainer.appendChild(contactInp);

      const submitBtn = document.createElement("button");
      submitBtn.style.cssText = "width:100%;padding:10px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s;";
      submitBtn.textContent = "Отправить контакты";

      submitBtn.onclick = async () => {
        const nameVal = nameInp.value.trim();
        const contactVal = contactInp.value.trim();
        if (!nameVal || !contactVal) {
          submitBtn.textContent = "Заполните все поля!";
          submitBtn.style.background = "#c0392b";
          setTimeout(() => {
            submitBtn.textContent = "Отправить контакты";
            submitBtn.style.background = "var(--accent)";
          }, 2000);
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Отправка...";

        const isEmail = contactVal.includes("@");
        const data = {
          visitor_id: state.visitorId,
          name: nameVal,
          message: "Контактные данные оставлены через компактную форму оффлайна.",
          page_url: location.href,
          ...(isEmail ? { email: contactVal } : { phone: contactVal })
        };

        const result = await api("POST", "/api/widget/offline-leads", data);
        if (result) {
          state.offlineFormSent = true;

          const successMsg = {
            id: "sys_" + Date.now(),
            session_id: state.session.id,
            sender: "system",
            message: "✅ Контакты успешно отправлены. Мы свяжемся с вами в ближайшее время!",
            status: "sent",
            created_at: new Date().toISOString()
          };
          state.messages.push(successMsg);
          state.showOfflineLeadForm = false;
          scheduleRender();
          setTimeout(scrollBottom, 50);
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = "Ошибка. Попробовать снова";
        }
      };

      formContainer.appendChild(submitBtn);
      formBbl.appendChild(formContainer);
      formWrap.appendChild(formBbl);
      formRow.appendChild(formWrap);
      c.appendChild(formRow);
    }

    // Typing indicator
    const typ = document.createElement("div");
    typ.className = "zw-typ" + (state.typing ? " show" : "");
    state.refs.typingEl = typ;
    const tAva = document.createElement("div");
    const isHuman = state.session?.status === "with_operator" || state.session?.status === "waiting_operator";
    tAva.className = isHuman ? "zw-ava op" : "zw-ava ai";
    tAva.textContent = isHuman ? "\uD83D\uDC68\u200D\uD83D\uDCBC" : "\uD83E\uDD16";
    typ.appendChild(tAva);
    const tBbl = document.createElement("div");
    tBbl.className = "zw-typ-bbl";
    tBbl.innerHTML = '<div class="zw-typ-dots"><span></span><span></span><span></span></div><span class="zw-typ-lbl">' +
      (isHuman ? "Оператор" : "AI-бот") + " печатает...</span>";
    typ.appendChild(tBbl);
    c.appendChild(typ);

    state._lastRenderedMsgCount = state.messages.length;
    return c;
  }

  // ═══ OPERATOR BAR ═══
  function mkOpBar(cfg) {
    const bar = document.createElement("div");
    bar.className = "zw-opbar";
    const btn = document.createElement("button");
    btn.innerHTML = IC.headphones + " Связаться с оператором";
    btn.setAttribute("aria-label", "Связаться с оператором");
    btn.onclick = requestOperator;
    bar.appendChild(btn);
    return bar;
  }

  // ═══ OFFLINE BANNER ═══
  function mkOfflineBanner() {
    const cfg = state.config || {};
    const mode = cfg.offline_mode || "message_only";
    const bh = state.businessHours;

    if (mode === "message_only") {
      const bar = document.createElement("div");
      bar.className = "zw-offline";
      const txt = document.createElement("div");
      txt.className = "zw-offline-txt";
      txt.textContent = bh?.offline_message || "Мы сейчас офлайн. Оставьте сообщение, и мы ответим!";
      bar.appendChild(txt);
      return bar;
    }

    if (mode === "redirect" && cfg.offline_redirect_url) {
      const bar2 = document.createElement("div");
      bar2.className = "zw-offline";
      const link = document.createElement("a");
      link.href = cfg.offline_redirect_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.cssText = "color:#7a4e32;font-weight:700;font-size:13px;text-decoration:underline;";
      link.textContent = "Перейти на страницу контактов →";
      bar2.appendChild(link);
      return bar2;
    }

    return mkOfflineForm(mode);
  }

  function mkOfflineForm(mode) {
    const cfg = state.config || {};
    const c = cfg.color || "#e8530e";
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:16px;border-top:1px solid #e8d5a8;background:#f5e6d3;";

    if (state.offlineFormSent) {
      wrap.innerHTML = '<div style="text-align:center;padding:12px;"><div style="font-size:24px;margin-bottom:6px;">✅</div><div style="font-size:14px;font-weight:700;color:#5b8c5a;">Спасибо! Мы свяжемся с вами.</div></div>';
      return wrap;
    }

    const title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;color:#7a4e32;margin-bottom:10px;text-align:center;";
    title.textContent = mode === "callback_request" ? "Заказать обратный звонок" : "Оставьте email — мы ответим";
    wrap.appendChild(title);

    const fields = {};
    const inputStyle = "width:100%;padding:8px 12px;border:1.5px solid #e5ddd3;border-radius:10px;font-size:13px;margin-bottom:8px;outline:none;font-family:inherit;background:#fff;color:#1a1206;";

    const nameInp = document.createElement("input");
    nameInp.placeholder = "Ваше имя";
    nameInp.setAttribute("aria-label", "Ваше имя");
    nameInp.style.cssText = inputStyle;
    if (state.visitorName) nameInp.value = state.visitorName;
    wrap.appendChild(nameInp);
    fields.name = nameInp;

    if (mode === "email_capture") {
      const emailInp = document.createElement("input");
      emailInp.type = "email";
      emailInp.placeholder = "Ваш email";
      emailInp.setAttribute("aria-label", "Ваш email");
      emailInp.style.cssText = inputStyle;
      wrap.appendChild(emailInp);
      fields.email = emailInp;
    }

    if (mode === "callback_request") {
      const phoneInp = document.createElement("input");
      phoneInp.type = "tel";
      phoneInp.placeholder = "Телефон для звонка";
      phoneInp.setAttribute("aria-label", "Телефон");
      phoneInp.style.cssText = inputStyle;
      wrap.appendChild(phoneInp);
      fields.phone = phoneInp;

      const timeInp = document.createElement("input");
      timeInp.placeholder = "Удобное время (напр. завтра 10:00)";
      timeInp.setAttribute("aria-label", "Удобное время");
      timeInp.style.cssText = inputStyle;
      wrap.appendChild(timeInp);
      fields.time = timeInp;
    }

    const msgInp = document.createElement("textarea");
    msgInp.placeholder = "Ваш вопрос...";
    msgInp.setAttribute("aria-label", "Ваш вопрос");
    msgInp.rows = 2;
    msgInp.style.cssText = "width:100%;padding:8px 12px;border:1.5px solid #e5ddd3;border-radius:10px;font-size:13px;margin-bottom:8px;outline:none;font-family:inherit;resize:none;background:#fff;color:#1a1206;";
    wrap.appendChild(msgInp);
    fields.message = msgInp;

    const btn = document.createElement("button");
    btn.style.cssText = "width:100%;padding:10px;border:none;border-radius:10px;background:" + c + ";color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;";
    btn.textContent = mode === "callback_request" ? "Заказать звонок" : "Отправить";
    btn.onclick = async () => {
      const data = {
        visitor_id: state.visitorId,
        name: fields.name?.value.trim() || "",
        message: fields.message?.value.trim() || "",
        page_url: location.href,
      };
      if (fields.email) data.email = fields.email.value.trim();
      if (fields.phone) data.phone = fields.phone.value.trim();
      if (fields.time) data.preferred_time = fields.time.value.trim();

      if (!data.name && !data.email && !data.phone) {
        btn.textContent = "Заполните хотя бы имя!";
        btn.style.background = "#c0392b";
        setTimeout(() => { btn.textContent = mode === "callback_request" ? "Заказать звонок" : "Отправить"; btn.style.background = c; }, 2000);
        return;
      }

      btn.disabled = true;
      btn.textContent = "Отправка...";
      const result = await api("POST", "/api/widget/offline-leads", data);
      if (result) {
        state.offlineFormSent = true;
        scheduleRender();
      } else {
        btn.disabled = false;
        btn.textContent = "Ошибка, попробуйте снова";
        btn.style.background = "#c0392b";
      }
    };
    wrap.appendChild(btn);
    return wrap;
  }

  // ═══ COMPOSER ═══
  function mkComposer(cfg) {
    const c = document.createElement("div");
    c.className = "zw-comp";

    const fInp = document.createElement("input");
    fInp.type = "file"; fInp.accept = "image/*"; fInp.style.display = "none";
    fInp.setAttribute("aria-hidden", "true");
    fInp.onchange = () => { handleUpload(fInp); };
    c.appendChild(fInp);

    const att = document.createElement("button");
    att.className = "zw-att";
    att.innerHTML = state.uploading ? '<svg class="zw-spin" viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" fill="#8c8072"/></svg>' : IC.image;
    att.disabled = state.uploading;
    att.onclick = () => { fInp.click(); };
    att.title = "Прикрепить изображение";
    att.setAttribute("aria-label", "Прикрепить изображение");
    c.appendChild(att);

    const inp = document.createElement("textarea");
    inp.className = "zw-inp";
    inp.placeholder = "Введите сообщение...";
    inp.setAttribute("aria-label", "Введите сообщение");
    inp.rows = 1;
    if (state.visitorDraftMessage) {
      inp.value = state.visitorDraftMessage;
    }
    inp.oninput = () => {
      state.visitorDraftMessage = inp.value;
      inp.style.height = "auto";
      inp.style.height = Math.min(inp.scrollHeight, 100) + "px";
      emitTyping();
    };
    inp.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(inp); }
    };
    c.appendChild(inp);

    const sndBtn = document.createElement("button");
    sndBtn.className = "zw-snd-btn";
    sndBtn.innerHTML = state.soundOn ? IC.soundOn : IC.soundOff;
    sndBtn.title = state.soundOn ? "Выключить звук" : "Включить звук";
    sndBtn.setAttribute("aria-label", state.soundOn ? "Выключить звук" : "Включить звук");
    sndBtn.onclick = toggleSound;
    c.appendChild(sndBtn);

    const send = document.createElement("button");
    send.className = "zw-send";
    send.innerHTML = IC.send;
    send.setAttribute("aria-label", "Отправить сообщение");
    send.onclick = () => { doSend(inp); };
    c.appendChild(send);

    return c;
  }

  // ═══ RATING ═══
  function mkRating(cfg) {
    const c = document.createElement("div");
    c.className = "zw-rate";
    c.setAttribute("role", "dialog");
    c.setAttribute("aria-label", "Оценка чата");

    if (state.ratingSubmitted) {
      c.innerHTML = '<div class="zw-rate-ok"><div class="emoji">\uD83C\uDF89</div><div class="txt">Спасибо за оценку!</div><div class="sub">Мы ценим ваше мнение</div></div>';
      setTimeout(() => {
        state.showRating = false;
        state.ratingSubmitted = false;
        closeChat();
        resetChat();
        scheduleRender();
      }, 2500);
      return c;
    }

    const title = document.createElement("div");
    title.className = "zw-rate-title";
    title.textContent = "Оцените чат";
    c.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "zw-rate-sub";
    sub.textContent = "Насколько вы довольны обслуживанием?";
    c.appendChild(sub);

    let selectedRating = 0;
    const stars = document.createElement("div");
    stars.className = "zw-stars";

    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("button");
      s.className = "zw-star";
      s.innerHTML = IC.star;
      s.setAttribute("aria-label", i + " из 5");
      s.onclick = () => {
        selectedRating = i;
        stars.querySelectorAll(".zw-star").forEach((el, idx) => {
          el.classList.toggle("active", idx < i);
        });
      };
      stars.appendChild(s);
    }
    c.appendChild(stars);

    const commentWrap = document.createElement("div");
    commentWrap.className = "zw-rate-comment";
    const commentInp = document.createElement("textarea");
    commentInp.placeholder = "Комментарий (необязательно)";
    commentInp.setAttribute("aria-label", "Комментарий");
    commentWrap.appendChild(commentInp);
    c.appendChild(commentWrap);

    const sendBtn = document.createElement("button");
    sendBtn.className = "zw-rate-send";
    sendBtn.textContent = "Отправить";
    sendBtn.onclick = () => {
      if (selectedRating === 0) return;
      submitRating(selectedRating, commentInp.value.trim());
    };
    c.appendChild(sendBtn);

    const skip = document.createElement("button");
    skip.className = "zw-rate-skip";
    skip.textContent = "Пропустить";
    skip.onclick = () => {
      state.showRating = false;
      closeChat();
      resetChat();
      scheduleRender();
    };
    c.appendChild(skip);

    return c;
  }

  // ═══ INVITATION ═══
  function mkInvitation(inv) {
    const invEl = document.createElement("div");
    invEl.className = "zw-inv show";
    invEl.setAttribute("role", "alertdialog");
    invEl.setAttribute("aria-label", "Приглашение в чат");

    const invHdr = document.createElement("div");
    invHdr.className = "zw-inv-hdr";
    const invAva = document.createElement("div");
    invAva.className = "zw-inv-ava";
    if (inv.operator_avatar) {
      invAva.innerHTML = '<img src="' + esc(API_BASE + inv.operator_avatar) + '" alt="Оператор">';
    } else {
      invAva.innerHTML = IC.person;
    }
    invHdr.appendChild(invAva);
    const invName = document.createElement("div");
    invName.className = "zw-inv-name";
    invName.textContent = inv.operator_name || "Оператор";
    invHdr.appendChild(invName);
    invEl.appendChild(invHdr);

    const invBody = document.createElement("div");
    invBody.className = "zw-inv-body";
    const invMsg = document.createElement("div");
    invMsg.className = "zw-inv-msg";
    invMsg.textContent = inv.message;
    invBody.appendChild(invMsg);
    invEl.appendChild(invBody);

    const invActs = document.createElement("div");
    invActs.className = "zw-inv-acts";

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "zw-inv-accept";
    acceptBtn.textContent = "Начать чат";
    acceptBtn.onclick = async () => {
      if (acceptBtn.disabled) return;
      acceptBtn.disabled = true;
      acceptBtn.textContent = "Подключение...";
      const invId = inv.id;
      state.pendingInvitation = null;
      api("PATCH", "/api/invitations/" + invId + "/accept", {});
      state.prechatDone = true;
      localStorage.setItem("zs_prechat_done", "1");
      if (!state.session) {
        const body = { visitor_id: state.visitorId, visitor_name: state.visitorName || "Гость", current_page: location.href, user_agent: navigator.userAgent };
        const session = await api("POST", "/api/widget/sessions", body);
        if (!session || session.error) {
          acceptBtn.disabled = false;
          acceptBtn.textContent = "Начать чат";
          return;
        }
        state.session = session;
        loadMessages(session.id);
        connectSocket(session.id);
        trackPage(session.id);
        startSessionPoll(session.id);
      }
      openChat();
      scheduleRender();
    };
    invActs.appendChild(acceptBtn);

    const declineBtn = document.createElement("button");
    declineBtn.className = "zw-inv-decline";
    declineBtn.textContent = "Не сейчас";
    declineBtn.onclick = () => {
      const invId = inv.id;
      state.pendingInvitation = null;
      api("PATCH", "/api/invitations/" + invId + "/decline", {});
      scheduleRender();
    };
    invActs.appendChild(declineBtn);
    invEl.appendChild(invActs);

    return invEl;
  }

  // ═══ LIGHTBOX ═══
  let _zsPausedMedia = [];
  function pauseBackgroundMedia() {
    try {
      document.documentElement.style.overflow = "hidden";
      _zsPausedMedia = [];
      document.querySelectorAll("video, audio").forEach((m) => {
        if (!m.paused) { _zsPausedMedia.push(m); try { m.pause(); } catch (e) {} }
      });
    } catch (e) {}
  }
  function resumeBackgroundMedia() {
    try {
      document.documentElement.style.overflow = "";
      _zsPausedMedia.forEach((m) => { try { m.play(); } catch (e) {} });
      _zsPausedMedia = [];
    } catch (e) {}
  }
  function openLightbox(url) { state.lightboxUrl = url; pauseBackgroundMedia(); scheduleRender(); }
  function closeLightbox() { state.lightboxUrl = null; resumeBackgroundMedia(); scheduleRender(); }
  function renderLightbox() {
    const lb = document.createElement("div");
    lb.className = "zw-lb";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-label", "Просмотр изображения");
    lb.onclick = () => closeLightbox();

    const x = document.createElement("button");
    x.className = "zw-lb-x";
    x.innerHTML = IC.close;
    x.setAttribute("aria-label", "Закрыть просмотр");
    x.onclick = () => closeLightbox();
    lb.appendChild(x);

    const img = document.createElement("img");
    img.src = state.lightboxUrl;
    img.alt = "Увеличенное изображение";
    img.onclick = (e) => { e.stopPropagation(); };
    lb.appendChild(img);

    shadow.appendChild(lb);
  }
  // ═══ ACTIONS ═══
  // ═══ Виджет-бот: клик по кнопке/карточке → продвинуть сценарий ═══
  function sendBotEvent(nodeId, handle, value) {
    if (!state.session) return;
    api("POST", "/api/widget/sessions/" + state.session.id + "/bot-event", { node_id: nodeId, handle: handle, value: value });
  }

  function makeBotBtn(b, nodeId) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zw-cbtn" + (b.color === "positive" ? " pos" : b.color === "negative" ? " neg" : "");
    btn.textContent = b.label || "Выбрать";
    btn.onclick = () => {
      if (b.url) { try { window.open(b.url, "_blank", "noopener"); } catch (e) {} return; }
      btn.disabled = true;
      sendBotEvent(nodeId, b.handle, b.label);
    };
    return btn;
  }

  async function startProductGuide() {
    let sid = state.session && state.session.id;
    if (!sid) {
      const body = { visitor_id: state.visitorId, visitor_name: state.visitorName || "Гость", current_page: location.href, user_agent: navigator.userAgent };
      const session = await api("POST", "/api/widget/sessions", body);
      if (!session || session.error) return;
      state.session = session;
      loadMessages(session.id);
      connectSocket(session.id);
      startSessionPoll(session.id);
      sid = session.id;
      scheduleRender();
    }
    await api("POST", "/api/widget/sessions/" + sid + "/bot-start", {});
  }

  async function doSend(inp) {
    const text = inp.value.trim();
    if (!text || !state.session || state.sending) return;
    inp.value = "";
    inp.style.height = "auto";
    state.visitorDraftMessage = "";

    // A/B tracking
    const cfg2 = state.config || {};
    if (cfg2._ab_variant && !state._abTrackedMsg) {
      state._abTrackedMsg = true;
      api("POST", "/api/widget/ab-track", { variant: cfg2._ab_variant, event: "messaged", visitor_id: state.visitorId });
    }

    state.sending = true;

    const msg = {
      id: "t_" + Date.now(),
      session_id: state.session.id,
      sender: "visitor",
      message: text,
      status: "sent",
      created_at: new Date().toISOString()
    };
    state.messages.push(msg);
    scheduleRender();
    setTimeout(scrollBottom, 50);

    await api("POST", "/api/widget/sessions/" + state.session.id + "/messages", { sender: "visitor", message: text });
    state.sending = false;

    if (state.socket) {
      state.socket.emit("typing_content", { sessionId: state.session.id, text: "", isTyping: false });
    }

    // Offline AI Auto-response & Lead form capture (Task 30).
    // Включаем ТОЛЬКО при реальном офлайне (business hours/checkOffline === true)
    // и если cfg.offline_mode НЕ "message_only" (для message_only работает только баннер-форма).
    // Раньше блок срабатывал по teamOperators (мог быть ещё null) — это давало ложные срабатывания.
    const cfgOff = state.config || {};
    const offModeAuto = cfgOff.offline_mode || "message_only";
    const isAiSession = !state.session || state.session.status === "ai";

    if (state.isOffline === true && offModeAuto !== "message_only" && isAiSession && !state.showOfflineLeadForm && !state.offlineFormSent) {
      setTimeout(async () => {
        const botMsgText = cfgOff.offline_message || (state.businessHours && state.businessHours.offline_message) || "Мы сейчас офлайн. Оставьте ваши контакты, и мы свяжемся с вами!";

        const botMsg = {
          id: "bot_" + Date.now(),
          session_id: state.session.id,
          sender: "ai",
          message: botMsgText,
          status: "sent",
          created_at: new Date().toISOString()
        };
        state.messages.push(botMsg);
        
        await api("POST", "/api/widget/sessions/" + state.session.id + "/messages", {
          sender: "ai",
          message: botMsgText
        });
        
        state.showOfflineLeadForm = true;
        scheduleRender();
        setTimeout(scrollBottom, 50);
      }, 1500);
    }
  }

  async function handleUpload(fInp) {
    const file = fInp.files?.[0];
    if (!file || !state.session) return;
    if (!file.type.startsWith("image/")) { alert("Только изображения"); return; }
    if (file.size > 5 * 1024 * 1024) { alert("Макс. 5MB"); return; }

    state.uploading = true;
    scheduleRender();
    const fd = new FormData();
    fd.append("file", file);

    const result = await api("POST", "/api/widget/sessions/" + state.session.id + "/messages/upload", fd);
    state.uploading = false;
    scheduleRender();
    if (!result) alert("Ошибка загрузки");
    fInp.value = "";
  }

  async function requestOperator() {
    if (!state.session) return;
    api("PATCH", "/api/widget/sessions/" + state.session.id + "/status", { status: "waiting_operator" });
    api("POST", "/api/widget/sessions/" + state.session.id + "/messages", {
      sender: "system",
      message: "\uD83D\uDD14 Вызываем оператора... Обычно отвечают в течение 2-3 минут."
    });
    state.session.status = "waiting_operator";
    scheduleRender();
  }

  var _lastTypingEmit = 0;
  function emitTyping() {
    if (!state.socket || !state.session) return;
    // Троттлинг: не чаще раза в 2с, иначе сокет флудит событиями на каждое нажатие.
    var now = Date.now();
    if (now - _lastTypingEmit < 2000) return;
    _lastTypingEmit = now;
    state.socket.emit("typing", {
      sessionId: state.session.id,
      session_id: state.session.id,
      sender: "visitor"
    });
  }

  async function submitRating(rating, comment) {
    if (!state.session) return;
    await api("POST", "/api/widget/sessions/" + state.session.id + "/rate", { rating, comment });
    state.ratingSubmitted = true;
    scheduleRender();
  }

  function resetChat() {
    state.session = null;
    state.messages = [];
    state.prechatDone = false;
    state.typing = false;
    state.showRating = false;
    state.ratingSubmitted = false;
    state.deliveredIds = {};
    state.readIds = {};
    state._lastRenderedMsgCount = 0;
    localStorage.removeItem("zs_prechat_done");
    if (state.sessionPollTimer) { clearInterval(state.sessionPollTimer); state.sessionPollTimer = null; }
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
  }

  // ═══ DELIVERY / READ ═══
  function markDelivered(ids) {
    if (!state.session || !ids.length) return;
    api("PATCH", "/api/widget/sessions/" + state.session.id + "/messages/deliver", { message_ids: ids });
  }

  function markVisibleAsRead() {
    if (!state.session || !state.open) return;
    const ids = [];
    state.messages.forEach((m) => {
      if (m.sender === "operator" && m.status !== "read" && !state.readIds[m.id]) {
        ids.push(m.id);
        state.readIds[m.id] = true;
      }
    });
    if (ids.length) api("PATCH", "/api/widget/sessions/" + state.session.id + "/messages/read", { message_ids: ids });
  }

  function autoDelivered() {
    if (!state.session) return;
    const ids = [];
    state.messages.forEach((m) => {
      if (m.sender === "operator" && m.status === "sent" && !state.deliveredIds[m.id]) {
        ids.push(m.id);
        state.deliveredIds[m.id] = true;
      }
    });
    if (ids.length) markDelivered(ids);
  }

  // ═══ SESSION ═══
  async function startSession(formData) {
    const body = {
      visitor_id: state.visitorId,
      visitor_name: state.visitorName || formData.name || "Гость",
      current_page: location.href,
      user_agent: navigator.userAgent,
    };
    if (formData.email) body.email = formData.email;
    if (formData.phone) body.phone = formData.phone;

    const extra = {};
    let hasExtra = false;
    Object.keys(formData).forEach((k) => {
      if (k !== "name" && formData[k]) { extra[k] = formData[k]; hasExtra = true; }
    });
    if (hasExtra) body.form_data = extra;

    const session = await api("POST", "/api/widget/sessions", body);
    if (!session || session.error) return;
    state.session = session;
    loadMessages(session.id);
    connectSocket(session.id);
    trackPage(session.id);
    startSessionPoll(session.id);
  }

  async function resumeSession() {
    const session = await api("GET", "/api/widget/sessions?visitor_id=" + encodeURIComponent(state.visitorId));
    if (session?.id) {
      state.session = session;
      state.prechatDone = true;
      localStorage.setItem("zs_prechat_done", "1");
      loadMessages(session.id);
      connectSocket(session.id);
      trackPage(session.id);
      startSessionPoll(session.id);
    }
  }

  async function loadMessages(sid) {
    const msgs = await api("GET", "/api/widget/sessions/" + sid + "/messages");
    if (Array.isArray(msgs)) {
      state.messages = msgs;
      scheduleRender();
      setTimeout(scrollBottom, 50);
      setTimeout(scrollBottom, 150);
      setTimeout(scrollBottom, 400);
      autoDelivered();
      if (state.open) markVisibleAsRead();
    }
  }

  function trackPage(sid) {
    api("PATCH", "/api/widget/sessions/" + sid + "/page", { url: location.href, title: document.title });
  }

  function startSessionPoll(sid) {
    if (state.sessionPollTimer) clearInterval(state.sessionPollTimer);
    state.sessionPollTimer = setInterval(async () => {
      const s = await api("GET", "/api/widget/sessions/" + sid);
      if (s?.id) {
        const oldStatus = state.session?.status;
        state.session = s;
        if (s.status === "closed" && !state.showRating) {
          state.showRating = true;
          showToast("Чат завершён — спасибо за обращение!", "info");
          scheduleRender();
        } else if (s.status !== oldStatus) {
          if (s.status === "with_operator" && oldStatus !== "with_operator") {
            const name = s.operator_name || "Оператор";
            showToast(name + " подключился к чату", "success");
          }
          scheduleRender();
        }
        const wasOffline = state.isOffline;
        state.isOffline = checkOffline();
        if (wasOffline !== state.isOffline) scheduleRender();
      }
      loadTeamOperators();
    }, 5000);
  }

  // ═══ TOASTS (внутри виджета) ═══
  function showToast(text, kind) {
    if (!state.refs.win) return;
    let host = shadow.querySelector(".zw-toasts");
    if (!host) {
      host = document.createElement("div");
      host.className = "zw-toasts";
      state.refs.win.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "zw-toast zw-toast-" + (kind || "info");
    el.textContent = text;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  // ═══ SOCKET.IO ═══
  function connectSocket(sid) {
    if (state.socket) {
      if (!state.socket._handlersAttached) {
        setupSessionHandlers(state.socket, sid);
      }
      if (state.socket.connected && state.socket._joinedSessionId !== sid) {
        state.socket._joinedSessionId = sid;
        state.socket.emit("join_session", { sessionId: sid, visitorId: state.visitorId });
      }
      // Гарантируем, что таймеры пингов запущены: light-сокет мог не стартовать их
      if (state.socket.connected && !state.socket._visitorPingTimer) {
        startVisitorPingTimers(state.socket);
      }
      scheduleRender();
      return;
    }

    const script = document.createElement("script");
    script.src = API_BASE + "/socket.io/socket.io.min.js"; // минифицированная сборка клиента (−~24 КиБ)
    script.onload = () => {
      const ioLib = window.io;
      if (!ioLib) return;

      const socket = ioLib(API_BASE, { path: "/ws", transports: ["websocket", "polling"] });
      state.socket = socket;

      socket.on("connect", () => {
        state.connected = true;
        const currentSid = state.session?.id || sid;
        if (socket._joinedSessionId !== currentSid) {
          socket._joinedSessionId = currentSid;
          socket.emit("join_session", { sessionId: currentSid, visitorId: state.visitorId });
        }
        startVisitorPingTimers(socket);
        scheduleRender();
      });

      socket.on("disconnect", () => {
        socket._joinedSessionId = null;
        state.connected = false;
        stopVisitorPingTimers();
        scheduleRender();
      });

      setupSessionHandlers(socket, sid);

      socket.on("invitation_sent", (data) => {
        if (data.visitor_id !== state.visitorId) return;
        state.pendingInvitation = data;
        if (!state.open) { playSound(); scheduleRender(); }
      });
    };
    document.head.appendChild(script);
  }

  // ═══ Visitor ping (один источник, ре-стартуется на каждом connect) ═══
  function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.indexOf("Firefox") > -1) return "Firefox";
    if (ua.indexOf("Edg") > -1) return "Edge";
    if (ua.indexOf("OPR") > -1 || ua.indexOf("Opera") > -1) return "Opera";
    if (ua.indexOf("YaBrowser") > -1) return "Yandex";
    if (ua.indexOf("Chrome") > -1) return "Chrome";
    if (ua.indexOf("Safari") > -1) return "Safari";
    return "Other";
  }

  function detectOS() {
    const ua = navigator.userAgent;
    if (ua.indexOf("Win") > -1) return "Windows";
    if (ua.indexOf("Mac") > -1) return "macOS";
    if (ua.indexOf("Linux") > -1) return "Linux";
    if (ua.indexOf("Android") > -1) return "Android";
    if (ua.indexOf("iPhone") > -1 || ua.indexOf("iPad") > -1) return "iOS";
    return "Other";
  }

  function sendVisitorPing() {
    if (!state.socket?.connected) return;
    const utm = getUtm();
    state.socket.emit("visitor_ping", {
      visitor_id: state.visitorId,
      page: location.href,
      title: document.title,
      referrer: document.referrer || "",
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      browser: detectBrowser(),
      os: detectOS(),
      language: navigator.language || "",
      screen: screen.width + "x" + screen.height,
    });
  }

  function startVisitorPingTimers(socket) {
    stopVisitorPingTimers();
    sendVisitorPing();
    socket._visitorPingTimer = setInterval(sendVisitorPing, 25000);
    socket._lastTrackedUrl = location.href;
    socket._pageCheckTimer = setInterval(() => {
      if (location.href !== socket._lastTrackedUrl) {
        socket._lastTrackedUrl = location.href;
        sendVisitorPing();
      }
    }, 2000);
  }

  function stopVisitorPingTimers() {
    const sk = state.socket;
    if (!sk) return;
    if (sk._visitorPingTimer) { clearInterval(sk._visitorPingTimer); sk._visitorPingTimer = null; }
    if (sk._pageCheckTimer)   { clearInterval(sk._pageCheckTimer);   sk._pageCheckTimer = null; }
  }

  function setupSessionHandlers(socket, sid) {
    if (socket._handlersAttached) return;
    socket._handlersAttached = true;

    socket.on("new_message", (msg) => {
      const currentSid = state.session?.id || sid;
      if (String(msg.session_id) !== String(currentSid)) return;
      if (msg.sender === "visitor") {
        state.messages = state.messages.filter((m) => {
          return !(m.id && String(m.id).indexOf("t_") === 0 && m.message === msg.message);
        });
        state.messages.push(msg);
        scheduleRender();
        return;
      }
      const exists = state.messages.some((m) => m.id === msg.id);
      if (exists) return;
      state.messages.push(msg);
      state.typing = false;
      playSound();
      if (!state.open) {
        state.unread++;
      } else if (msg.sender === "operator") {
        state.deliveredIds[msg.id] = true;
        state.readIds[msg.id] = true;
        api("PATCH", "/api/widget/sessions/" + currentSid + "/messages/read", { message_ids: [msg.id] });
      }
      scheduleRender();
    });

    socket.on("typing", (data) => {
      const dataSid = data.sessionId || data.session_id;
      const currentSid = state.session?.id || sid;
      if (String(dataSid) !== String(currentSid) || data.sender === "visitor") return;
      state.typing = true;
      updateTypingIndicator();
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(() => {
        state.typing = false;
        updateTypingIndicator();
      }, 3000);
    });

    socket.on("message_status_changed", (data) => {
      const currentSid = state.session?.id || sid;
      if (String(data.session_id) !== String(currentSid)) return;
      data.messages.forEach((u) => {
        state.messages.forEach((m) => {
          if (m.id === u.id) {
            m.status = u.status;
            if (u.delivered_at) m.delivered_at = u.delivered_at;
            if (u.read_at) m.read_at = u.read_at;
          }
        });
      });
      scheduleRender();
    });
    socket.on("reaction_updated", (data) => {
      if (!data.message_id) return;
      const currentSid = state.session?.id || sid;
      api("GET", "/api/widget/sessions/" + currentSid + "/messages").then(function(msgs) {
        if (Array.isArray(msgs)) {
          state.messages = msgs;
          scheduleRender();
        }
      });
    });
    socket.on("operator_status_changed", () => {
      loadTeamOperators();
    });
  }

  // ═══ VISIBILITY + SPA PAGE TRACKING ═══
  // Глобальные подписки — кэшируем на window, чтобы повторный <script src> не плодил дубли.
  if (!window.__zsGlobalsAttached) {
    window.__zsGlobalsAttached = true;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (state.sessionPollTimer) {
          clearInterval(state.sessionPollTimer);
          state.sessionPollTimer = null;
        }
      } else {
        // Вернулись на вкладку — сразу пингуем, чтобы снова попасть в онлайн
        sendVisitorPing();
        if (state.session) {
          startSessionPoll(state.session.id);
          markVisibleAsRead();
        }
      }
    });

    // Уход со страницы — сообщаем серверу, чтобы presence освободился сразу (не ждать TTL)
    var notifyLeave = function () {
      try {
        if (state.socket && state.socket.connected && state.visitorId) {
          state.socket.emit("visitor_leave", { visitor_id: state.visitorId });
        }
      } catch (e) { /* ignore */ }
    };
    window.addEventListener("pagehide", notifyLeave);
    window.addEventListener("beforeunload", notifyLeave);

    let lastUrl = location.href;
    function onUrlMaybeChanged() {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        applyWidgetVisibility();            // прячем/показываем виджет по правилам страниц (фикс «/admin всё равно показывается» на SPA)
        // SPA: перешли со скрытой страницы на разрешённую, а виджет ещё ни разу не отрендерился
        // (init вышел рано на !isWidgetAllowedOnPage). Доинициализируем полностью.
        if (!window.__zsPreviewConfig && !state._rendered && isWidgetAllowedOnPage()) {
          try { host.style.display = ""; } catch (e) {}
          init();
        }
        if (state.session) trackPage(state.session.id);
      }
    }
    setInterval(onUrlMaybeChanged, 1500);
    // Перехват SPA-навигации для мгновенного пересчёта (Next.js/React и т.п.)
    try {
      ["pushState", "replaceState"].forEach((m) => {
        const orig = history[m];
        if (typeof orig === "function") {
          history[m] = function () { const r = orig.apply(this, arguments); setTimeout(onUrlMaybeChanged, 0); return r; };
        }
      });
      window.addEventListener("popstate", onUrlMaybeChanged);
    } catch (e) { /* ignore */ }

    // ═══ МОБИЛЬНАЯ ШТОРКА: высота под клавиатуру (visualViewport) + свайп-вниз для закрытия ═══
    setupMobileSheet();
  }

  // Подгоняем высоту bottom_sheet под видимую область (visualViewport) — composer не уезжает
  // под клавиатуру в iOS. Свайп вниз по верхней зоне/handle закрывает шторку.
  function setupMobileSheet() {
    function applyVVH() {
      const root = state.refs.root;
      if (!root) return;
      const vv = window.visualViewport;
      const mode = (state.config && state.config.mobile_window_mode) || "bottom_sheet";
      const isMobile = root.classList.contains("zw-mobile");
      if (vv && state.open && isMobile && mode === "bottom_sheet") {
        // Высота шторки = min(92% видимой области, видимая высота) — учитывает клавиатуру.
        root.style.setProperty("--zw-vvh", Math.round(vv.height * 0.92) + "px");
      } else {
        root.style.removeProperty("--zw-vvh");
      }
    }
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", applyVVH);
        window.visualViewport.addEventListener("scroll", applyVVH);
      }
    } catch (e) { /* ignore */ }
    state._applyVVH = applyVVH;

    // Свайп-вниз по верхней области окна (где handle) для закрытия шторки.
    let startY = 0, curY = 0, dragging = false, winEl = null;
    function onTouchStart(e) {
      const root = state.refs.root;
      if (!root || !state.open || !root.classList.contains("zw-mobile")) return;
      const mode = (state.config && state.config.mobile_window_mode) || "bottom_sheet";
      if (mode !== "bottom_sheet") return;
      winEl = shadow.querySelector(".zw-win.open");
      if (!winEl) return;
      // Реагируем только если палец стартовал в верхних 56px окна (зона handle).
      const rect = winEl.getBoundingClientRect();
      const t = e.touches[0];
      if (t.clientY - rect.top > 56) { winEl = null; return; }
      startY = t.clientY; curY = startY; dragging = true;
      winEl.classList.add("zw-dragging");
    }
    function onTouchMove(e) {
      if (!dragging || !winEl) return;
      curY = e.touches[0].clientY;
      const dy = Math.max(0, curY - startY);
      winEl.style.transform = "translate3d(0," + dy + "px,0)";
    }
    function onTouchEnd() {
      if (!dragging || !winEl) return;
      dragging = false;
      const dy = Math.max(0, curY - startY);
      const el = winEl;
      el.classList.remove("zw-dragging");
      el.style.transition = "transform .32s var(--ez-expo)";
      el.style.transform = "";
      // Порог закрытия — 120px.
      if (dy > 120) {
        closeChat();
        scheduleRender();
      }
      setTimeout(() => { try { el.style.transition = ""; } catch (e) {} }, 340);
      winEl = null;
    }
    try {
      shadow.addEventListener("touchstart", onTouchStart, { passive: true });
      shadow.addEventListener("touchmove", onTouchMove, { passive: true });
      shadow.addEventListener("touchend", onTouchEnd, { passive: true });
      shadow.addEventListener("touchcancel", onTouchEnd, { passive: true });
    } catch (e) { /* ignore */ }
  }

  // ═══ BUSINESS HOURS ═══
  function checkOffline() {
    const bh = state.businessHours;
    if (!bh || !bh.enabled) return false;

    const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    let now;
    try {
      now = new Date(new Date().toLocaleString("en-US", { timeZone: bh.timezone || "Europe/Moscow" }));
    } catch(e) {
      now = new Date();
    }

    const dayKey = dayMap[now.getDay()];
    const schedule = bh.schedule?.[dayKey];
    if (!schedule || !schedule.enabled) return true;

    const hhmm = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
    return hhmm < schedule.from || hhmm >= schedule.to;
  }

  // ═══ TRIGGERS ═══
  function setupTriggers(cfg) {
    const tr = cfg.triggers;
    if (!tr) return;

    // Exit intent — один раз на вкладку (persist в sessionStorage 'zw_exit_trigger')
    if (tr.exit_intent && !sessionStorage.getItem("zw_exit_trigger")) {
      document.addEventListener("mouseleave", (e) => {
        if (e.clientY <= 0 && !state.open && !state.exitShown) {
          state.exitShown = true;
          try { sessionStorage.setItem("zw_exit_trigger", "1"); } catch (err) {}
          openChat();
          scheduleRender();
        }
      });
    }

    // Scroll percent — один раз на вкладку (persist в sessionStorage 'zw_scroll_trigger')
    if (tr.scroll_percent > 0 && !sessionStorage.getItem("zw_scroll_trigger")) {
      const scrollHandler = () => {
        if (state.scrollShown || state.open) return;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = Math.max(
          document.body.scrollHeight, document.documentElement.scrollHeight,
          document.body.offsetHeight, document.documentElement.offsetHeight
        );
        const winHeight = window.innerHeight;
        const scrolled = (scrollTop / (docHeight - winHeight)) * 100;
        if (scrolled >= tr.scroll_percent) {
          state.scrollShown = true;
          try { sessionStorage.setItem("zw_scroll_trigger", "1"); } catch (err) {}
          openChat();
          scheduleRender();
          window.removeEventListener("scroll", scrollHandler);
        }
      };
      window.addEventListener("scroll", scrollHandler, { passive: true });
    }

    // Time on page
    if (tr.time_on_page > 0) {
      const wasTimeAuto = sessionStorage.getItem("zw_time_trigger");
      if (!wasTimeAuto) {
        setTimeout(() => {
          if (!state.open) {
            openChat();
            scheduleRender();
            sessionStorage.setItem("zw_time_trigger", "1");
          }
        }, tr.time_on_page * 1000);
      }
    }

    // Inactivity — один раз на вкладку (persist в sessionStorage 'zw_idle_trigger')
    if (tr.inactivity_seconds > 0 && !sessionStorage.getItem("zw_idle_trigger")) {
      const resetIdle = () => {
        clearTimeout(state.idleTimer);
        if (state.idleShown || state.open) return;
        state.idleTimer = setTimeout(() => {
          if (!state.open && !state.idleShown) {
            state.idleShown = true;
            try { sessionStorage.setItem("zw_idle_trigger", "1"); } catch (err) {}
            openChat();
            scheduleRender();
          }
        }, tr.inactivity_seconds * 1000);
      };
      ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((ev) => {
        document.addEventListener(ev, resetIdle, { passive: true });
      });
      resetIdle();
    }

    // Page URL contains
    if (tr.page_url_contains?.length > 0) {
      const patterns = tr.page_url_contains.split(",").map((s) => s.trim().toLowerCase());
      const currentUrl = location.href.toLowerCase();
      const match = patterns.some((p) => p && currentUrl.indexOf(p) !== -1);
      if (match && !state.open) {
        const wasPageTrigger = sessionStorage.getItem("zw_page_trigger_" + location.pathname);
        if (!wasPageTrigger) {
          setTimeout(() => {
            if (!state.open) {
              openChat();
              scheduleRender();
              sessionStorage.setItem("zw_page_trigger_" + location.pathname, "1");
            }
          }, 1500);
        }
      }
    }

    setupAutoMessages(cfg);
  }

  // ═══ AUTO MESSAGES ═══
  function setupAutoMessages(cfg) {
    const msgs = cfg.auto_messages;
    if (!msgs?.length) return;

    msgs.forEach((am) => {
      if (!am.enabled) return;
      const storageKey = "zw_automsg_" + am.id;
      if (am.show_once && localStorage.getItem(storageKey)) return;

      const fire = async () => {
        if (state.autoMsgShown[am.id]) return;
        if (am.page_filter) {
          const url = location.href.toLowerCase();
          const patterns = am.page_filter.split(",").map((s) => s.trim().toLowerCase());
          const match = patterns.some((p) => p && url.indexOf(p) !== -1);
          if (!match) return;
        }
        state.autoMsgShown[am.id] = true;
        if (am.show_once) localStorage.setItem(storageKey, "1");

        const fakeMsg = {
          id: "auto_" + am.id + "_" + Date.now(),
          session_id: state.session?.id || null,
          sender: "ai",
          message: am.message,
          status: "delivered",
          created_at: new Date().toISOString(),
          _auto: true,
          _sender_name: am.sender_name || "Бот",
        };

        if (state.session) {
          state.messages.push(fakeMsg);
          playSound();
          if (!state.open) state.unread++;
          scheduleRender();
        } else {
          if (!state.open) {
            state.open = true;
            state.unread = 0;
          }
          state.prechatDone = true;
          localStorage.setItem("zs_prechat_done", "1");

          const body = {
            visitor_id: state.visitorId,
            visitor_name: state.visitorName || "Гость",
            current_page: location.href,
            user_agent: navigator.userAgent,
          };
          const session = await api("POST", "/api/widget/sessions", body);
          if (!session || session.error) return;
          state.session = session;
          fakeMsg.session_id = session.id;
          state.messages.push(fakeMsg);
          connectSocket(session.id);
          trackPage(session.id);
          startSessionPoll(session.id);
          api("POST", "/api/widget/sessions/" + session.id + "/messages", { sender: "ai", message: am.message });
          scheduleRender();
        }
      };

      if (am.trigger === "first_visit") {
        const visitCount = parseInt(localStorage.getItem("zw_visit_count") || "0");
        if (visitCount <= 1) setTimeout(fire, (am.delay_seconds || 0) * 1000);
      } else if (am.trigger === "return_visit") {
        const vc = parseInt(localStorage.getItem("zw_visit_count") || "0");
        if (vc > 1) setTimeout(fire, (am.delay_seconds || 0) * 1000);
      } else if (am.trigger === "on_page") {
        setTimeout(fire, (am.delay_seconds || 0) * 1000);
      } else if (am.trigger === "after_idle") {
        let idleAm;
        const resetAmIdle = () => {
          clearTimeout(idleAm);
          idleAm = setTimeout(fire, (am.delay_seconds || 30) * 1000);
        };
        ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((ev) => {
          document.addEventListener(ev, resetAmIdle, { passive: true });
        });
        resetAmIdle();
      } else if (am.trigger === "cart_abandon") {
        if (/cart|checkout|корзин/i.test(location.href)) {
          setTimeout(fire, (am.delay_seconds || 15) * 1000);
        }
      }
    });

    // Track visit count
    const vc = parseInt(localStorage.getItem("zw_visit_count") || "0");
    if (!sessionStorage.getItem("zw_visit_counted")) {
      localStorage.setItem("zw_visit_count", String(vc + 1));
      sessionStorage.setItem("zw_visit_counted", "1");
    }
  }

  // ═══ PAGE RULES ═══
  function applyPageRules(cfg) {
    const rules = cfg.page_rules;
    if (!rules?.length) return cfg;

    const url = location.href;
    const merged = Object.assign({}, cfg);

    rules.forEach((rule) => {
      if (!rule.enabled) return;
      let match = false;
      if (rule.match_type === "exact") {
        match = url === rule.pattern;
      } else if (rule.match_type === "contains") {
        const patterns = rule.pattern.split(",").map((s) => s.trim().toLowerCase());
        match = patterns.some((p) => p && url.toLowerCase().indexOf(p) !== -1);
      } else if (rule.match_type === "regex") {
        try { match = new RegExp(rule.pattern, "i").test(url); } catch(e) {}
      }
      if (match && rule.override) {
        Object.keys(rule.override).forEach((k) => {
          merged[k] = rule.override[k];
        });
      }
    });

    return merged;
  }

  // ═══ IDENTITY ═══
  function readIdentity() {
    // Читаем window.ZSConfig.user только если оператор включил верификацию личности.
    if (!state.config || !state.config.identity_verification) return;
    if (window.ZSConfig?.user) {
      state.identityUser = window.ZSConfig.user;
      if (state.identityUser.name) {
        state.visitorName = state.identityUser.name;
        localStorage.setItem("zs_visitor_name", state.identityUser.name);
      }
      if (state.identityUser.id) {
        state.visitorId = "id_" + state.identityUser.id;
        localStorage.setItem(VISITOR_KEY, state.visitorId);
      }
    }
  }

  // ═══ LOAD TEAM OPERATORS ═══
  async function loadTeamOperators() {
    const data = await api("GET", "/api/widget/team");
    if (Array.isArray(data)) {
      const changed = JSON.stringify(data) !== JSON.stringify(state.teamOperators);
      state.teamOperators = data;
      if (changed) {
        scheduleRender();
      }
    } else {
      const changed = state.teamOperators && state.teamOperators.length > 0;
      state.teamOperators = [];
      if (changed) {
        scheduleRender();
      }
    }
  }

  function ensurePreviewTeam() {
    if (!window.__zsPreviewConfig) return;
    if (state.config && state.config.team_mode && (!state.teamOperators || !state.teamOperators.length)) {
      state.teamOperators = [
        { id: "demo1", name: "Анна", avatar_url: null },
        { id: "demo2", name: "Иван", avatar_url: null },
        { id: "demo3", name: "Мария", avatar_url: null }
      ];
    }
  }

  // ═══ ВИДИМОСТЬ ПО СТРАНИЦЕ (моб./include/exclude), пересчёт на SPA-навигации ═══
  function isWidgetAllowedOnPage() {
    if (window.__zsPreviewConfig) return true; // в превью настроек всегда показываем
    const cfg = state.config || {};
    if (cfg.hide_on_mobile && /Mobi|Android/i.test(navigator.userAgent)) return false;
    const mode = cfg.display_pages_mode || "all";
    const pagesStr = cfg.display_pages || "";
    if (mode !== "all" && pagesStr.trim()) {
      const patterns = pagesStr.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const url = location.href.toLowerCase();
      const matches = patterns.some((p) => url.indexOf(p) !== -1);
      if (mode === "include" && !matches) return false;
      if (mode === "exclude" && matches) return false;
    }
    return true;
  }
  function applyWidgetVisibility() {
    try { host.style.display = isWidgetAllowedOnPage() ? "" : "none"; } catch (e) { /* host ещё не готов */ }
  }

  // ═══ INIT ═══
  async function init() {
    // Listen for postMessage updates for live preview
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "ZS_PREVIEW_UPDATE") {
        const payload = event.data.payload || {};
        if (event.data.previewSize) {
          if (!window.__zsPreviewConfig) window.__zsPreviewConfig = {};
          window.__zsPreviewConfig.previewSize = event.data.previewSize;
        }
        if (payload.widget_config) {
          state.config = payload.widget_config;
          loadFont(state.config);
          state.cardDismissed = false; // Reset dismissed state to show updated card styling immediately
          ensurePreviewTeam();
        }
        if (payload.prechat_form) {
          state.prechat = payload.prechat_form;
        }
        if (payload.business_hours !== undefined) {
          state.businessHours = payload.business_hours;
          state.isOffline = checkOffline();
        }
        if (event.data.forceOpen !== undefined) {
          state.open = !!event.data.forceOpen;
          if (state.open && payload.prechat_form?.enabled && !event.data.skipPrechatPreview) {
            state.prechatDone = false;
          }
        }
        if (event.data.skipPrechatPreview !== undefined) {
          state.prechatDone = !!event.data.skipPrechatPreview;
        }
        scheduleRender();
      }
    });

    let data;
    if (window.__zsPreviewConfig) {
      data = window.__zsPreviewConfig;
    } else {
      data = await api("GET", "/api/widget/settings");
    }
    if (!data) return;

    const rawConfig = data.widget_config || {};
    state.config = applyPageRules(rawConfig);
    readIdentity(); // после установки config — гейт по cfg.identity_verification
    state.prechat = data.prechat_form || { enabled: false };
    state.businessHours = data.business_hours || null;
    state.domainSettings = data.domain_settings || null;

    // Check domain restriction
    if (state.domainSettings?.enabled && state.domainSettings.domains?.length > 0) {
      const currentHost = location.hostname.replace(/^www\./, "");
      const allowed = state.domainSettings.domains.some((d) => {
        const clean = d.replace(/^www\./, "");
        return currentHost === clean || currentHost.endsWith("." + clean);
      });
      if (!allowed) return;
    }

    // Check business hours
    state.isOffline = checkOffline();

    // Видимость по странице (моб./include/exclude) — единая функция, пересчитывается и на SPA-навигации
    if (!isWidgetAllowedOnPage()) return;

    // Load font
    loadFont(state.config);

    // Load team operators (в превью — демо-состав, реальный API замокан)
    if (state.config.team_mode) {
      if (window.__zsPreviewConfig) {
        ensurePreviewTeam();
      } else {
        loadTeamOperators();
      }
    }

    // В превью всегда показываем раскрытый виджет, чтобы было видно оформление шапки/цветов.
    // Точное состояние (открыт / пречат-форма) дальше уточняет postMessage от экрана настроек.
    if (window.__zsPreviewConfig) {
      state.cardDismissed = false;
      state.open = true;
      state.prechatDone = true;
    }

    render();
    state._rendered = true; // отмечаем, что виджет реально отрисован (используется в SPA-доинициализации)

    // Light socket for invitations (only in normal mode, skip in preview)
    if (!window.__zsPreviewConfig && !state.socket) {
      const invScript = document.createElement("script");
      invScript.src = API_BASE + "/socket.io/socket.io.min.js"; // минифицированная сборка клиента (−~24 КиБ)
      invScript.onload = () => {
        const ioLib = window.io;
        if (!ioLib || state.socket) return;

        const lightSocket = ioLib(API_BASE, { path: "/ws", transports: ["websocket", "polling"] });

        lightSocket.on("connect", () => {
          state.connected = true;
          // Рекуррентный heartbeat + трекинг страницы даже до открытия чата,
          // иначе сервер метит посетителя offline через ~60с (главная причина «нет посетителей»).
          startVisitorPingTimers(lightSocket);
        });

        lightSocket.on("invitation_sent", (data) => {
          if (data.visitor_id !== state.visitorId) return;
          state.pendingInvitation = data;
          playSound();
          scheduleRender();
        });

        lightSocket.on("disconnect", () => {
          state.connected = false;
          stopVisitorPingTimers();
        });

        state.socket = lightSocket;
      };
      document.head.appendChild(invScript);
    }

    if (!window.__zsPreviewConfig && state.prechatDone) resumeSession();

    // Мобильное приглашение «Нажми на меня» — показать после задержки.
    // Не планируем заново, если посетитель уже закрыл тизер в этой вкладке (persist).
    if (!window.__zsPreviewConfig && window.innerWidth <= 480 && state.config.mobile_invitation_enabled !== false && !state.mobileInviteDismissed) {
      const delay = Math.max(0, state.config.mobile_invitation_delay ?? 5) * 1000;
      setTimeout(() => {
        if (!state.open && !state.mobileInviteDismissed) {
          state.mobileInviteShown = true;
          scheduleRender();
        }
      }, delay);
    }

    // Восстановление состояния "открыто" между визитами
    if (!window.__zsPreviewConfig && state.config.remember_open_state !== false) {
      try {
        if (localStorage.getItem("zs_widget_open") === "1" && state.prechatDone) {
          setTimeout(() => { openChat(); scheduleRender(); }, 300);
        }
      } catch (e) { /* ignore */ }
    }

    // Auto open delay
    if (!window.__zsPreviewConfig && state.config.auto_open_delay > 0 && !state.prechatDone) {
      const wasAuto = sessionStorage.getItem("zw_auto");
      if (!wasAuto) {
        setTimeout(() => {
          if (!state.open) {
            openChat();
            scheduleRender();
            sessionStorage.setItem("zw_auto", "1");
          }
        }, state.config.auto_open_delay * 1000);
      }
    }

    // Setup triggers
    if (!window.__zsPreviewConfig) {
      setupTriggers(state.config);
    }

    // Auto theme: listen for changes
    if (state.config.theme === "auto") {
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
          scheduleRender();
        });
      } catch(e) {}
    }

    // Listen for window resize to handle preview size changes dynamically
    window.addEventListener("resize", () => {
      if (window.__zsPreviewConfig) {
        scheduleRender();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();      