(function() {
  "use strict";

  // Защита от двойной инициализации (если script подключили дважды).
  if (window.__zsWidgetInited) return;
  window.__zsWidgetInited = true;

  const SCRIPT = document.currentScript;
  const API_BASE = (SCRIPT && SCRIPT.getAttribute("data-api")) || "https://zhivaya-skazka.ru";
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
    return "v_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) { id = genId(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
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
    const c = cfg.color || "#d97706";
    const gf = cfg.gradient_from || c;
    const gto = cfg.gradient_to || "#fbbf24";
    const ga = cfg.gradient_angle || 135;
    if (gt === "gradient") return "linear-gradient(" + ga + "deg," + gf + "," + gto + ")";
    if (gt === "glass") return "rgba(255,255,255,0.15)";
    if (gt === "animated") return "linear-gradient(270deg," + gf + "," + gto + "," + gf + ")";
    return c;
  }

  function getHdrBg(cfg) {
    const gt = cfg.gradient_type || "solid";
    const c = cfg.color || "#d97706";
    const gf = cfg.gradient_from || c;
    const gto = cfg.gradient_to || "#fbbf24";
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
    return { bg:"#fff", text:"#1f2937", bubble:"#f3f4f6", border:"#e5e7eb", msgsBg:"linear-gradient(180deg,#f8f9fa 0%,#fff 100%)", inputBg:"#fff", inputBorder:"#d1d5db", sysBg:"#f3f4f6", sysText:"#6b7280" };
  }

  // ═══ FONT HELPER ═══
  function getFontFamily(cfg) {
    const f = cfg.font_family || "onest";
    if (f === "onest") return '"Onest","Inter",-apple-system,BlinkMacSystemFont,sans-serif';
    if (f === "inter") return '"Inter",sans-serif';
    if (f === "roboto") return '"Roboto",sans-serif';
    if (f === "montserrat") return '"Montserrat",sans-serif';
    if (f === "custom" && cfg.custom_font_url) return '"CustomWidgetFont",sans-serif';
    return '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
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
    const f = cfg.font_family || "onest";
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
    // triggers
    exitShown: false, scrollShown: false,
    idleTimer: null, idleShown: false,
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
  };
  // ═══ CSS ═══
  function getCSS(cfg) {
    const c = cfg?.color || "#d97706";
    const pos = cfg?.position || "bottom-right";
    const isR = pos.indexOf("right") !== -1;
    const side = isR ? "right" : "left";
    const safeCss = sanitizeCSS(cfg.custom_css);
    const tv = getThemeVars(cfg);
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
    const winShadow =
      shadowI === "subtle" ? "0 4px 16px rgba(0,0,0,0.08)" :
      shadowI === "strong" ? "0 24px 60px rgba(0,0,0,0.28)" :
      "0 12px 48px rgba(0,0,0,0.18)";
    const fabShadow =
      shadowI === "subtle" ? "0 2px 8px var(--accent-30)" :
      shadowI === "strong" ? "0 8px 28px var(--accent-60)" :
      "0 4px 16px var(--accent-50)";

    return `
:host {
  all: initial;
  isolation: isolate;
  --accent: ${c};
  --accent-50: ${c}50;
  --accent-60: ${c}60;
  --accent-40: ${c}40;
  --accent-35: ${c}35;
  --accent-18: ${c}18;
  --accent-08: ${c}08;
  --accent-30: ${c}30;
  --bg: ${tv.bg};
  --text: ${tv.text};
  --bubble: ${tv.bubble};
  --border: ${tv.border};
  --msgs-bg: ${tv.msgsBg};
  --input-bg: ${tv.inputBg};
  --input-border: ${tv.inputBorder};
  --sys-bg: ${tv.sysBg};
  --sys-text: ${tv.sysText};
  --fab-bg: ${fabBg};
  --fab-size: ${fabSize};
  --fab-radius: ${fabRadius};
  --pulse-radius: ${pulseRadius};
  --hdr-bg: ${hdrBg};
  --font: ${ff};
  --win-hidden: ${winHidden};
  --win-visible: ${winVisible};
}

*{margin:0;padding:0;box-sizing:border-box;}

.zw{font-family:var(--font);font-size:${fontSize};line-height:1.5;position:fixed;bottom:${edgeMargin};${side}:${edgeMargin};z-index:2147483647;}

/* FAB */
.zw-fab{width:var(--fab-size);height:var(--fab-size);border-radius:var(--fab-radius);background:var(--fab-bg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:${fabShadow},0 0 0 1px rgba(255,255,255,0.15) inset;transition:transform .2s var(--ez,cubic-bezier(.16,1,.3,1)),box-shadow .25s;position:relative;${gt === "glass" ? "backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.3);" : ""}${gt === "animated" ? "background-size:400% 400%;animation:zw-gradient-shift 3s ease infinite;" : ""}}
.zw-fab:hover{transform:scale(1.06) translateY(-1px);box-shadow:0 10px 28px var(--accent-60),0 0 0 1px rgba(255,255,255,0.2) inset;}
.zw-fab:active{transform:scale(0.96);}
.zw-fab svg{width:26px;height:26px;fill:#fff;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.18));}
${gt === "animated" ? "@keyframes zw-gradient-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}" : ""}
.zw-fab-pulse{position:absolute;inset:-4px;border-radius:var(--pulse-radius);background:var(--accent-30);animation:zw-ping 2s ease infinite;pointer-events:none;}
${cfg.launcher_pulse === false ? ".zw-fab-pulse{display:none;}" : ""}
@keyframes zw-ping{75%,100%{transform:scale(1.4);opacity:0}}
.zw-badge{position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff;animation:zw-pop .3s ease;}
@keyframes zw-pop{0%{transform:scale(0)}50%{transform:scale(1.3)}100%{transform:scale(1)}}

/* Launcher card */
.zw-launcher{position:absolute;bottom:0;${side}:0;display:flex;align-items:center;gap:12px;cursor:pointer;transition:all .2s;}
.zw-launcher-card{background:#fff;border-radius:16px;padding:12px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.12);display:flex;align-items:center;gap:12px;border:1px solid #f0f0f0;max-width:280px;margin-${side}:68px;transition:all .2s;}
.zw-launcher-card:hover{box-shadow:0 6px 28px rgba(0,0,0,0.16);transform:translateY(-2px);}
.zw-launcher-ava{width:40px;height:40px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}
.zw-launcher-ava img{width:100%;height:100%;object-fit:cover;}
.zw-launcher-ava svg{width:20px;height:20px;fill:#fff;}
.zw-launcher-info{flex:1;min-width:0;}
.zw-launcher-text{font-size:13px;font-weight:700;color:#1f2937;line-height:1.3;}
.zw-launcher-sub{font-size:11px;color:#6b7280;margin-top:2px;}
.zw-launcher-close{width:20px;height:20px;border-radius:50%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:12px;color:#9ca3af;cursor:pointer;flex-shrink:0;transition:all .15s;}
.zw-launcher-close:hover{background:#e5e7eb;color:#374151;}

/* Icon+text launcher */
.zw-fab-text{display:flex;align-items:center;gap:8px;padding:0 20px 0 16px;width:auto;border-radius:28px;height:var(--fab-size);}
.zw-fab-text svg{width:22px;height:22px;}
.zw-fab-label{font-size:14px;font-weight:600;white-space:nowrap;color:#fff;}

/* Window */
.zw-win{position:absolute;bottom:68px;${side}:0;width:${winWidth};max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 100px);background:var(--bg);border-radius:20px;box-shadow:${winShadow};display:flex;flex-direction:column;overflow:hidden;${winHidden}transition:all .3s cubic-bezier(.4,0,.2,1);pointer-events:none;}
.zw-win.open{${winVisible}pointer-events:all;}

/* Header */
.zw-hdr{background:var(--hdr-bg);color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;position:relative;overflow:hidden;${gt === "animated" ? "background-size:400% 400%;animation:zw-gradient-shift 3s ease infinite;" : ""}}
.zw-hdr::after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.1) 0%,transparent 50%);pointer-events:none;}
.zw-hdr-ava{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;backdrop-filter:blur(8px);}
.zw-hdr-ava img{width:100%;height:100%;object-fit:cover;}
.zw-hdr-ava svg{width:22px;height:22px;fill:#fff;}
.zw-hdr-info{flex:1;min-width:0;}
.zw-hdr-name{font-weight:700;font-size:15px;text-shadow:0 1px 2px rgba(0,0,0,0.1);}
.zw-hdr-st{font-size:12px;opacity:0.9;display:flex;align-items:center;gap:6px;}
.zw-hdr-resp{font-size:11px;opacity:0.8;margin-top:2px;}
.zw-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;flex-shrink:0;}
.zw-dot.wait{background:#facc15;animation:zw-blink 1.5s infinite;}
.zw-dot.offline{background:#9ca3af;}
@keyframes zw-blink{0%,100%{opacity:1}50%{opacity:0.3}}
.zw-hdr-acts{display:flex;gap:6px;z-index:1;}
.zw-hdr-btn{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.zw-hdr-btn:hover{background:rgba(255,255,255,0.25);}
.zw-hdr-btn svg{width:16px;height:16px;fill:#fff;}

/* Team avatars */
.zw-team{display:flex;align-items:center;}
.zw-team-ava{width:32px;height:32px;border-radius:50%;border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(255,255,255,0.2);font-size:13px;font-weight:700;color:#fff;}
.zw-team-ava img{width:100%;height:100%;object-fit:cover;}
.zw-team-count{font-size:11px;opacity:0.85;margin-left:8px;}

/* Messages */
.zw-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:2px;background:var(--msgs-bg);}
.zw-date{text-align:center;padding:12px 0 8px;}
.zw-date span{background:var(--sys-bg);color:var(--sys-text);font-size:11px;font-weight:500;padding:4px 12px;border-radius:10px;}
.zw-row{display:flex;margin-bottom:6px;animation:zw-in .2s ease;}
.zw-row.v{justify-content:flex-end;}
.zw-row.o{justify-content:flex-start;}
@keyframes zw-in{from{opacity:0;transform:translateY(6px)}}
.zw-wrap{display:flex;align-items:flex-end;gap:8px;max-width:80%;}
.zw-row.v .zw-wrap{flex-direction:row-reverse;}
.zw-ava{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;overflow:hidden;}
.zw-ava.vv{background:linear-gradient(135deg,var(--accent),${c}cc);}
.zw-ava.op{background:linear-gradient(135deg,#22c55e,#10b981);}
.zw-ava.ai{background:linear-gradient(135deg,#3b82f6,#06b6d4);}
.zw-ava img{width:100%;height:100%;object-fit:cover;}
.zw-ava svg{width:14px;height:14px;fill:#fff;}
.zw-bbl{border-radius:${bubbleR};overflow:hidden;max-width:100%;}
.zw-row.v .zw-bbl{background:var(--accent);color:#fff;border-bottom-right-radius:6px;}
.zw-row.o .zw-bbl{background:var(--bg);color:var(--text);border:1px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,0.06);border-bottom-left-radius:6px;}
.zw-sender{font-size:11px;font-weight:600;padding:8px 14px 0;}
.zw-sender.sop{color:#16a34a;}
.zw-sender.sai{color:#3b82f6;}
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
.zw-row.v .zw-st.rd svg{fill:#93c5fd;}
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
.zw-qr-btn{padding:8px 14px;border-radius:18px;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;}
.zw-qr-btn:hover{background:var(--accent);color:#fff;}

/* Typing */
.zw-typ{display:none;align-items:flex-end;gap:8px;margin-bottom:6px;}
.zw-typ.show{display:flex;}
.zw-typ-bbl{padding:12px 16px;background:var(--bg);border:1px solid var(--border);border-radius:18px;border-bottom-left-radius:6px;display:flex;align-items:center;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
.zw-typ-dots{display:flex;gap:3px;}
.zw-typ-dots span{width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:zw-bounce 1.2s infinite;}
.zw-typ-dots span:nth-child(2){animation-delay:.15s;}
.zw-typ-dots span:nth-child(3){animation-delay:.3s;}
@keyframes zw-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
.zw-typ-lbl{font-size:11px;color:#9ca3af;}

/* Operator bar */
.zw-opbar{padding:8px 16px;border-top:1px solid var(--border);background:var(--bg);text-align:center;flex-shrink:0;}
.zw-opbar button{background:none;border:1px solid var(--border);cursor:pointer;color:var(--sys-text);font-size:13px;padding:8px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;transition:all .15s;font-family:inherit;}
.zw-opbar button:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-08);}
.zw-opbar button svg{width:15px;height:15px;fill:currentColor;}

/* Composer */
.zw-comp{padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end;background:var(--input-bg);flex-shrink:0;min-width:0;}
.zw-att{width:36px;height:36px;border-radius:10px;background:var(--bubble);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.zw-att:hover{background:var(--border);}
.zw-att:disabled{opacity:0.4;cursor:default;}
.zw-att svg{width:18px;height:18px;fill:#6b7280;}
.zw-inp{flex:1;border:1.5px solid var(--input-border);border-radius:20px;padding:9px 16px;font-size:14px;font-family:inherit;resize:none;max-height:100px;outline:none;line-height:1.4;transition:all .15s;background:var(--input-bg);color:var(--text);}
.zw-inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-18);}
.zw-snd-btn{width:36px;height:36px;border-radius:10px;background:var(--bubble);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.zw-snd-btn:hover{background:var(--border);}
.zw-snd-btn svg{width:17px;height:17px;fill:#6b7280;}
.zw-send{width:40px;height:40px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;box-shadow:0 2px 8px var(--accent-40);}
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
.zw-field .req{color:#ef4444;margin-left:3px;}
.zw-field input,.zw-field select,.zw-field textarea{width:100%;border:1.5px solid var(--border);border-radius:14px;padding:12px 16px;font-size:14px;font-family:inherit;outline:none;transition:border-color .18s,box-shadow .18s,background .18s;background:var(--input-bg);color:var(--text);}
.zw-field input:hover,.zw-field select:hover,.zw-field textarea:hover{border-color:var(--accent-50);}
.zw-field input:focus,.zw-field select:focus,.zw-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--accent-18);}
.zw-field .err{border-color:#ef4444!important;box-shadow:0 0 0 4px rgba(239,68,68,0.12)!important;}
.zw-field .err-txt{color:#ef4444;font-size:11px;margin-top:6px;font-weight:600;}
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
.zw-star:hover,.zw-star.active{background:#fef3c7;transform:scale(1.1);}
.zw-star svg{width:24px;height:24px;fill:#d1d5db;transition:fill .15s;}
.zw-star:hover svg,.zw-star.active svg{fill:#f59e0b;}
.zw-rate-comment{width:100%;}
.zw-rate-comment textarea{width:100%;border:1.5px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;outline:none;resize:none;height:80px;transition:all .15s;background:var(--input-bg);color:var(--text);}
.zw-rate-comment textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-18);}
.zw-rate-send{background:var(--accent);color:#fff;border:none;border-radius:12px;padding:12px 32px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit;}
.zw-rate-send:hover{opacity:0.9;}
.zw-rate-skip{background:none;border:none;color:#9ca3af;font-size:13px;cursor:pointer;margin-top:-4px;font-family:inherit;}
.zw-rate-skip:hover{color:#6b7280;}
.zw-rate-ok{text-align:center;}
.zw-rate-ok .emoji{font-size:48px;margin-bottom:12px;}
.zw-rate-ok .txt{font-size:16px;font-weight:600;color:var(--text);}
.zw-rate-ok .sub{font-size:13px;color:#9ca3af;margin-top:4px;}

/* Greeting bubble */
.zw-greet{position:absolute;bottom:68px;${side}:0;background:var(--bg);border-radius:16px;padding:14px 18px;box-shadow:0 4px 24px rgba(0,0,0,0.12);max-width:260px;font-size:14px;color:var(--text);white-space:pre-wrap;cursor:pointer;opacity:0;transform:translateY(10px);transition:all .3s cubic-bezier(.4,0,.2,1);pointer-events:none;line-height:1.5;border:1px solid var(--border);}
.zw-greet.show{opacity:1;transform:translateY(0);pointer-events:all;}
.zw-greet-x{position:absolute;top:6px;right:10px;background:none;border:none;cursor:pointer;font-size:16px;color:#ccc;line-height:1;}
.zw-greet-x:hover{color:#999;}

/* Lightbox */
.zw-lb{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:16px;animation:zw-fade .2s ease;}
.zw-lb img{max-width:90vw;max-height:90vh;border-radius:12px;object-fit:contain;cursor:default;}
.zw-lb-x{position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}
.zw-lb-x:hover{background:rgba(255,255,255,0.25);}
.zw-lb-x svg{width:20px;height:20px;fill:#fff;}

/* Spinner */
.zw-spin{animation:zw-sp .7s linear infinite;}
@keyframes zw-sp{to{transform:rotate(360deg)}}

/* Offline banner */
.zw-offline{padding:12px 16px;background:linear-gradient(135deg,#fef3c7,#fde68a);text-align:center;flex-shrink:0;border-top:1px solid #fcd34d;}
.zw-offline-txt{font-size:13px;color:#92400e;font-weight:600;line-height:1.4;}

/* Invitation popup */
.zw-inv{position:absolute;bottom:68px;${side}:0;background:var(--bg);border-radius:20px;padding:0;box-shadow:0 8px 32px rgba(0,0,0,0.16);max-width:320px;width:calc(100vw - 48px);overflow:hidden;opacity:0;transform:translateY(12px);transition:all .3s cubic-bezier(.4,0,.2,1);pointer-events:none;border:1px solid var(--border);}
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
.zw-toast{max-width:88%;padding:8px 14px;border-radius:14px;font-size:13px;font-weight:600;color:#fff;box-shadow:0 8px 22px rgba(0,0,0,0.18);opacity:0;transform:translateY(-8px);transition:all .25s cubic-bezier(.16,1,.3,1);}
.zw-toast.show{opacity:1;transform:translateY(0);}
.zw-toast-success{background:linear-gradient(135deg,#16a34a,#65a30d);}
.zw-toast-info{background:linear-gradient(135deg,#d97706,#fbbf24);color:#1c1917;}
.zw-toast-error{background:linear-gradient(135deg,#dc2626,#ef4444);}

/* Mobile */
@media(max-width:480px){
  .zw{bottom:16px;${side}:16px;}
  ${(() => {
    const mode = cfg.mobile_window_mode || "fullscreen";
    if (mode === "fullscreen") {
      return ".zw-win{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;max-width:100%;max-height:100%;border-radius:0;z-index:2147483647;height:100vh;height:100dvh;height:-webkit-fill-available;}.zw-win.open~.zw-fab{display:none;}";
    }
    if (mode === "bottom_sheet") {
      return ".zw-win{position:fixed;left:0;right:0;bottom:0;top:auto;width:100%;max-width:100%;height:75vh;height:75dvh;max-height:75dvh;border-radius:22px 22px 0 0;box-shadow:0 -8px 28px rgba(0,0,0,0.18);z-index:2147483647;}.zw-win.open~.zw-fab{display:none;}";
    }
    // popup
    return ".zw-win{position:fixed;left:8px;right:8px;bottom:80px;top:auto;width:auto;max-width:none;height:auto;max-height:70vh;border-radius:20px;z-index:2147483647;}";
  })()}
  .zw-launcher-card{${(cfg.mobile_launcher_type === "card" || (cfg.mobile_launcher_type === "inherit" && cfg.launcher_type === "card")) ? "display:flex;max-width:280px;" : "display:none;"}}
  .zw-hdr{padding:14px 16px;padding-top:max(14px, env(safe-area-inset-top, 0px));position:sticky;top:0;z-index:10;flex-shrink:0;}
  .zw-comp{padding:10px 12px;padding-bottom:max(10px, env(safe-area-inset-bottom, 0px));padding-right:max(12px, env(safe-area-inset-right, 0px));padding-left:max(12px, env(safe-area-inset-left, 0px));position:sticky;bottom:0;z-index:10;flex-shrink:0;}
  .zw-offline{padding-bottom:max(12px, env(safe-area-inset-bottom, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px));padding-left:max(16px, env(safe-area-inset-left, 0px));}
  .zw-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .zw-inp{font-size:16px;}

  /* Мобильное приглашение поверх FAB */
  .zw-mob-invite{position:absolute;bottom:calc(var(--fab-size) + 20px);${side}:0;background:#fff;color:#1c1917;padding:10px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.18);font-size:13px;font-weight:600;max-width:220px;white-space:normal;cursor:pointer;animation:zw-mob-pop .35s cubic-bezier(.16,1,.3,1);}
  .zw-mob-invite::after{content:"";position:absolute;bottom:-6px;${side}:24px;width:12px;height:12px;background:#fff;transform:rotate(45deg);box-shadow:2px 2px 4px rgba(0,0,0,0.06);}
  .zw-mob-invite-x{position:absolute;top:-8px;${isR ? "left" : "right"}:-8px;width:22px;height:22px;border-radius:50%;background:#1c1917;color:#fff;border:none;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.2);}
  @keyframes zw-mob-pop{from{opacity:0;transform:scale(0.7) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
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

    // 2. Reuse or create Root container
    let root = shadow.querySelector(".zw");
    if (!root) {
      root = document.createElement("div");
      root.className = "zw";
      root.setAttribute("role", "region");
      shadow.appendChild(root);
    }
    root.setAttribute("aria-label", cfg.header_title || "Онлайн-чат");
    state.refs.root = root;

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
    const isMobileViewport = window.innerWidth <= 480;
    const mobileLT = cfg.mobile_launcher_type;
    const lt = (isMobileViewport && mobileLT && mobileLT !== "inherit")
      ? mobileLT
      : (cfg.launcher_type || "icon_only");
    const greetSeen = cfg.greet_once === true && localStorage.getItem("zs_greet_seen") === "1";
    if (!state.open && cfg.greeting && !state.prechatDone && lt === "icon_only" && !greetSeen) {
      if (cfg.greet_once === true) {
        try { localStorage.setItem("zs_greet_seen", "1"); } catch (e) { /* ignore */ }
      }
      const g = document.createElement("div");
      g.className = "zw-greet show";
      g.textContent = cfg.greeting;
      const gx = document.createElement("button");
      gx.className = "zw-greet-x";
      gx.textContent = "\u00d7";
      gx.setAttribute("aria-label", "Закрыть приветствие");
      gx.onclick = (e) => { e.stopPropagation(); g.classList.remove("show"); };
      g.appendChild(gx);
      g.onclick = () => { openChat(); };
      root.appendChild(g);
    }

    // 5. Launcher card
    if (!state.open && lt === "card") {
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
      lcClose.onclick = (e) => { e.stopPropagation(); lc.style.display = "none"; };
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
    if (!state.open && (lt === "icon_text" || lt === "text_only")) {
      fab.className = "zw-fab zw-fab-text";
      if (lt !== "text_only") fab.innerHTML = icon;
      const lbl = document.createElement("span");
      lbl.className = "zw-fab-label";
      lbl.textContent = cfg.launcher_text || cfg.button_text || "Помощь";
      fab.appendChild(lbl);
    } else {
      fab.className = "zw-fab";
      fab.innerHTML = state.open ? IC.close : icon;
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
        state.open = false;
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
    if (isMobileViewport && !state.open && cfg.mobile_invitation_enabled !== false && !state.mobileInviteDismissed && state.mobileInviteShown) {
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
        state.mobileInviteDismissed = true;
        scheduleRender();
      };
      inv.appendChild(x);
      inv.onclick = (e) => {
        if (e.target === x) return;
        state.mobileInviteDismissed = true;
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
      }
    }

    // Focus trap on open
    if (state.open) {
      const firstFocus = shadow.querySelector(".zw-inp") || shadow.querySelector(".zw-hdr-btn");
      if (firstFocus) setTimeout(() => firstFocus.focus(), 100);
    }
    // Fix mobile keyboard resize
    if (state.open && window.visualViewport && window.innerWidth <= 480) {
      const vv = window.visualViewport;
      const winEl = shadow.querySelector(".zw-win");
      if (winEl) {
        const applyVV = () => {
          winEl.style.height = vv.height + "px";
          winEl.style.top = vv.offsetTop + "px";
        };
        vv.addEventListener("resize", applyVV);
        vv.addEventListener("scroll", applyVV);
        applyVV();
      }
    } 
  }

  function openChat() {
    state.open = true;
    state.unread = 0;
    markVisibleAsRead();
    const cfg = state.config || {};
    if (cfg.remember_open_state !== false) {
      try { localStorage.setItem("zs_widget_open", "1"); } catch (e) { /* ignore */ }
    }
    // Сброс таймера авто-сворачивания
    if (state._autoMinTimer) { clearTimeout(state._autoMinTimer); state._autoMinTimer = null; }
    if ((cfg.auto_minimize_after || 0) > 0) {
      state._autoMinTimer = setTimeout(() => {
        state.open = false;
        scheduleRender();
      }, cfg.auto_minimize_after * 1000);
    }
    if (cfg._ab_variant && !state._abTrackedOpen) {
      state._abTrackedOpen = true;
      api("POST", "/api/widget/ab-track", { variant: cfg._ab_variant, event: "opened", visitor_id: state.visitorId });
    }
  }

  function scrollBottom() {
    const el = shadow.getElementById("zw-msgs");
    if (el) el.scrollTop = el.scrollHeight;
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
    } else {
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
    closeBtn.onclick = () => { state.open = false; scheduleRender(); };
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
        img.onclick = () => { state.lightboxUrl = imgUrl; scheduleRender(); };
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
      formBbl.style.cssText = "background:var(--bg);border:1px solid var(--border);box-shadow:0 4px 12px rgba(0,0,0,0.08);border-bottom-left-radius:6px;width:100%;";

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
          submitBtn.style.background = "#ef4444";
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
    tAva.className = state.session?.status === "with_operator" ? "zw-ava op" : "zw-ava ai";
    tAva.textContent = state.session?.status === "with_operator" ? "\uD83D\uDC68\u200D\uD83D\uDCBC" : "\uD83E\uDD16";
    typ.appendChild(tAva);
    const tBbl = document.createElement("div");
    tBbl.className = "zw-typ-bbl";
    tBbl.innerHTML = '<div class="zw-typ-dots"><span></span><span></span><span></span></div><span class="zw-typ-lbl">' +
      (state.session?.status === "with_operator" ? "Оператор" : "AI-бот") + " печатает...</span>";
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
      link.style.cssText = "color:#92400e;font-weight:700;font-size:13px;text-decoration:underline;";
      link.textContent = "Перейти на страницу контактов →";
      bar2.appendChild(link);
      return bar2;
    }

    return mkOfflineForm(mode);
  }

  function mkOfflineForm(mode) {
    const cfg = state.config || {};
    const c = cfg.color || "#d97706";
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:16px;border-top:1px solid #fcd34d;background:linear-gradient(135deg,#fffbeb,#fef3c7);";

    if (state.offlineFormSent) {
      wrap.innerHTML = '<div style="text-align:center;padding:12px;"><div style="font-size:24px;margin-bottom:6px;">✅</div><div style="font-size:14px;font-weight:700;color:#065f46;">Спасибо! Мы свяжемся с вами.</div></div>';
      return wrap;
    }

    const title = document.createElement("div");
    title.style.cssText = "font-size:14px;font-weight:700;color:#92400e;margin-bottom:10px;text-align:center;";
    title.textContent = mode === "callback_request" ? "Заказать обратный звонок" : "Оставьте email — мы ответим";
    wrap.appendChild(title);

    const fields = {};
    const inputStyle = "width:100%;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;margin-bottom:8px;outline:none;font-family:inherit;";

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
    msgInp.style.cssText = "width:100%;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;margin-bottom:8px;outline:none;font-family:inherit;resize:none;";
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
        btn.style.background = "#ef4444";
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
        btn.style.background = "#ef4444";
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
    att.innerHTML = state.uploading ? '<svg class="zw-spin" viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" fill="#6b7280"/></svg>' : IC.image;
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
    inp.oninput = () => {
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
        state.open = false;
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
      state.open = false;
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
  function renderLightbox() {
    const lb = document.createElement("div");
    lb.className = "zw-lb";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-label", "Просмотр изображения");
    lb.onclick = () => { state.lightboxUrl = null; scheduleRender(); };

    const x = document.createElement("button");
    x.className = "zw-lb-x";
    x.innerHTML = IC.close;
    x.setAttribute("aria-label", "Закрыть просмотр");
    x.onclick = () => { state.lightboxUrl = null; scheduleRender(); };
    lb.appendChild(x);

    const img = document.createElement("img");
    img.src = state.lightboxUrl;
    img.alt = "Увеличенное изображение";
    img.onclick = (e) => { e.stopPropagation(); };
    lb.appendChild(img);

    shadow.appendChild(lb);
  }
  // ═══ ACTIONS ═══
  async function doSend(inp) {
    const text = inp.value.trim();
    if (!text || !state.session || state.sending) return;
    inp.value = "";
    inp.style.height = "auto";

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

    // Offline AI Auto-response & Lead form capture (Task 30)
    const hasOnlineOperator = state.teamOperators && state.teamOperators.some(op => op.status === "online");
    const isOfflineMode = state.isOffline || !hasOnlineOperator;

    if (isOfflineMode && !state.showOfflineLeadForm && !state.offlineFormSent) {
      setTimeout(async () => {
        const botMsgText = "Я сейчас оффлайн, но подключусь в ближайшее время. Оставьте ваши контакты, и я сразу свяжусь с вами!";
        
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

  function emitTyping() {
    if (!state.socket || !state.session) return;
    state.socket.emit("typing", { sessionId: state.session.id, sender: "visitor" });
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
    // Уже есть сокет — просто заджойнить комнату (один раз) и подвесить хендлеры (один раз).
    if (state.socket) {
      if (!state.socket._handlersAttached) {
        setupSessionHandlers(state.socket, sid);
      }
      if (state.socket.connected && !state.socket._joinedSession) {
        state.socket._joinedSession = true;
        state.socket.emit("join_session", sid);
      }
      scheduleRender();
      return;
    }

    const script = document.createElement("script");
    script.src = API_BASE + "/socket.io/socket.io.js";
    script.onload = () => {
      const ioLib = window.io;
      if (!ioLib) return;

      const socket = ioLib(API_BASE, { path: "/ws", transports: ["websocket", "polling"] });
      state.socket = socket;

      socket.on("connect", () => {
        state.connected = true;
        if (!socket._joinedSession) {
          socket._joinedSession = true;
          socket.emit("join_session", sid);
        }
        startVisitorPingTimers(socket);
        scheduleRender();
      });

      socket.on("disconnect", () => {
        socket._joinedSession = false;
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
    state.socket.emit("visitor_ping", {
      visitor_id: state.visitorId,
      page: location.href,
      title: document.title,
      referrer: document.referrer || "",
      browser: detectBrowser(),
      os: detectOS(),
      language: navigator.language || "",
      screen: screen.width + "x" + screen.height,
    });
  }

  function startVisitorPingTimers(socket) {
    stopVisitorPingTimers();
    sendVisitorPing();
    socket._visitorPingTimer = setInterval(sendVisitorPing, 30000);
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
      if (msg.session_id !== sid) return;
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
        api("PATCH", "/api/widget/sessions/" + sid + "/messages/read", { message_ids: [msg.id] });
      }
      scheduleRender();
    });

    socket.on("typing", (data) => {
      if (data.sessionId !== sid || data.sender === "visitor") return;
      state.typing = true;
      updateTypingIndicator();
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(() => {
        state.typing = false;
        updateTypingIndicator();
      }, 3000);
    });

    socket.on("message_status_changed", (data) => {
      if (data.session_id !== sid) return;
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
      api("GET", "/api/widget/sessions/" + sid + "/messages").then(function(msgs) {
        if (Array.isArray(msgs)) {
          state.messages = msgs;
          scheduleRender();
        }
      });
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
        if (state.session) {
          startSessionPoll(state.session.id);
          markVisibleAsRead();
        }
      }
    });

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (state.session) trackPage(state.session.id);
      }
    }, 2000);
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

    // Exit intent
    if (tr.exit_intent) {
      document.addEventListener("mouseleave", (e) => {
        if (e.clientY <= 0 && !state.open && !state.exitShown) {
          state.exitShown = true;
          openChat();
          scheduleRender();
        }
      });
    }

    // Scroll percent
    if (tr.scroll_percent > 0) {
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

    // Inactivity
    if (tr.inactivity_seconds > 0) {
      const resetIdle = () => {
        clearTimeout(state.idleTimer);
        if (state.idleShown || state.open) return;
        state.idleTimer = setTimeout(() => {
          if (!state.open && !state.idleShown) {
            state.idleShown = true;
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
      state.teamOperators = data;
      scheduleRender();
    } else {
      state.teamOperators = [];
    }
  }

  // ═══ INIT ═══
  async function init() {
    // Listen for postMessage updates for live preview
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "ZS_PREVIEW_UPDATE") {
        const payload = event.data.payload || {};
        if (payload.widget_config) {
          state.config = payload.widget_config;
          loadFont(state.config);
        }
        if (payload.prechat_form) {
          state.prechat = payload.prechat_form;
        }
        if (payload.business_hours !== undefined) {
          state.businessHours = payload.business_hours;
          state.isOffline = checkOffline();
        }
        if (event.data.forceOpen) {
          state.open = true;
          if (payload.prechat_form?.enabled && !event.data.skipPrechatPreview) {
            state.prechatDone = false;
          }
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
    readIdentity();
    state.config = applyPageRules(rawConfig);
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

    if (state.config.hide_on_mobile && /Mobi|Android/i.test(navigator.userAgent)) return;

    // Видимость виджета по страницам (include/exclude)
    const mode = state.config.display_pages_mode || "all";
    const pagesStr = state.config.display_pages || "";
    if (mode !== "all" && pagesStr.trim()) {
      const patterns = pagesStr.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const url = location.href.toLowerCase();
      const matches = patterns.some((p) => url.indexOf(p) !== -1);
      if (mode === "include" && !matches) return;
      if (mode === "exclude" && matches) return;
    }

    // Load font
    loadFont(state.config);

    // Load team operators
    if (state.config.team_mode) {
      loadTeamOperators();
    }

    render();

    // Light socket for invitations
    if (!state.socket) {
      const invScript = document.createElement("script");
      invScript.src = API_BASE + "/socket.io/socket.io.js";
      invScript.onload = () => {
        const ioLib = window.io;
        if (!ioLib || state.socket) return;

        const lightSocket = ioLib(API_BASE, { path: "/ws", transports: ["websocket", "polling"] });

        lightSocket.on("connect", () => {
          state.connected = true;
          lightSocket.emit("visitor_ping", {
            visitor_id: state.visitorId,
            page: location.href,
            title: document.title,
            referrer: document.referrer || "",
            browser: navigator.userAgent.indexOf("Chrome") > -1 ? "Chrome" : "Other",
            os: navigator.userAgent.indexOf("Win") > -1 ? "Windows" : "Other",
            language: navigator.language || "",
            screen: screen.width + "x" + screen.height,
          });
        });

        lightSocket.on("invitation_sent", (data) => {
          if (data.visitor_id !== state.visitorId) return;
          state.pendingInvitation = data;
          playSound();
          scheduleRender();
        });

        lightSocket.on("disconnect", () => {
          state.connected = false;
        });

        state.socket = lightSocket;
      };
      document.head.appendChild(invScript);
    }

    if (state.prechatDone) resumeSession();

    // Мобильное приглашение «Нажми на меня» — показать после задержки
    if (window.innerWidth <= 480 && state.config.mobile_invitation_enabled !== false) {
      const delay = Math.max(0, state.config.mobile_invitation_delay ?? 5) * 1000;
      setTimeout(() => {
        if (!state.open && !state.mobileInviteDismissed) {
          state.mobileInviteShown = true;
          scheduleRender();
        }
      }, delay);
    }

    // Восстановление состояния "открыто" между визитами
    if (state.config.remember_open_state !== false) {
      try {
        if (localStorage.getItem("zs_widget_open") === "1" && state.prechatDone) {
          setTimeout(() => { openChat(); scheduleRender(); }, 300);
        }
      } catch (e) { /* ignore */ }
    }

    // Auto open delay
    if (state.config.auto_open_delay > 0 && !state.prechatDone) {
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
    setupTriggers(state.config);

    // Auto theme: listen for changes
    if (state.config.theme === "auto") {
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
          scheduleRender();
        });
      } catch(e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();      