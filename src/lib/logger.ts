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
  }).join(" ").replace(/Bearer\s+[^\s"\x27]+/gi, "Bearer [hidden]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[hidden]").slice(0, 1500);

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
    const match = args[0].match(/^\[([^\]]+)\]/);
    if (match) return match[1];
  }
  return "app";
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

// Crash details stay on this device; exporting diagnostics is an explicit UI action.
window.addEventListener("error", event => addLog("error", "runtime", event.message || "Runtime error"));
window.addEventListener("unhandledrejection", event => addLog("error", "promise", event.reason instanceof Error ? event.reason.message : "Unhandled operation"));
