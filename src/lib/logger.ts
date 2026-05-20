type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
}

const MAX_LOGS = 500;
const logs: LogEntry[] = [];
const listeners: Set<() => void> = new Set();

function formatTime(): string {
  const d = new Date();
  return d.toLocaleTimeString("ru-RU", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function addLog(level: LogLevel, tag: string, ...args: any[]) {
  const message = args.map(a => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");

  logs.push({ time: formatTime(), level, tag, message });
  if (logs.length > MAX_LOGS) logs.shift();

  listeners.forEach(fn => fn());
}

// Перехватываем console.log/warn/error
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args: any[]) => {
  origLog(...args);
  const tag = extractTag(args);
  addLog("info", tag, ...args);
};

console.warn = (...args: any[]) => {
  origWarn(...args);
  const tag = extractTag(args);
  addLog("warn", tag, ...args);
};

console.error = (...args: any[]) => {
  origError(...args);
  const tag = extractTag(args);
  addLog("error", tag, ...args);
};

function extractTag(args: any[]): string {
  if (args.length > 0 && typeof args[0] === "string") {
    const match = args[0].match(/^$$([^$$]+)\]/);
    if (match) return match[1];
  }
  return "app";
}

// Добавляем специальные логи для FCM диагностики
export function logFcmDiag() {
  addLog("debug", "diag", "=== FCM Diagnostics ===");
  addLog("debug", "diag", "window.__FCM_TOKEN: " + ((window as any).__FCM_TOKEN ? (window as any).__FCM_TOKEN.substring(0, 30) + "..." : "NOT SET"));
  addLog("debug", "diag", "window.__FCM_PLATFORM: " + ((window as any).__FCM_PLATFORM || "NOT SET"));
  addLog("debug", "diag", "window.AndroidFCM exists: " + !!(window as any).AndroidFCM);
  addLog("debug", "diag", "fcm_token_sent in LS: " + (localStorage.getItem("fcm_token_sent") ? "YES" : "NO"));
  addLog("debug", "diag", "chat_token in LS: " + (localStorage.getItem("chat_token") ? "YES" : "NO"));
  addLog("debug", "diag", "Platform: " + navigator.userAgent.substring(0, 80));
  addLog("debug", "diag", "__TAURI_INTERNALS__: " + !!(window as any).__TAURI_INTERNALS__);
}

export function getLogs(): LogEntry[] {
  return logs;
}

export function clearLogs() {
  logs.length = 0;
  listeners.forEach(fn => fn());
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Автоматически запускаем диагностику через 3 сек после загрузки
setTimeout(() => {
  logFcmDiag();
}, 3000);

// === Глобальный логгер критических ошибок на сервер ===
async function reportCrash(type: "error" | "unhandledrejection", message: string, stack?: string) {
  try {
    const crashReport = {
      type: "crash_report",
      crashType: type,
      message,
      stack: stack || new Error().stack || "",
      url: typeof window !== "undefined" ? window.location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      time: new Date().toISOString(),
      recentLogs: logs.slice(-30), // последние 30 логов для детального контекста
    };

    origLog("[CrashLogger] Обнаружена критическая ошибка! Отправка логов на сервер...", crashReport);

    await fetch("/api/logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(crashReport),
    });
  } catch (err) {
    origError("[CrashLogger] Не удалось отправить отчет о краше на сервер:", err);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const message = event.message || (event.error && event.error.message) || String(event);
    const stack = event.error && event.error.stack;
    void reportCrash("error", message, stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    void reportCrash("unhandledrejection", message, stack);
  });
}