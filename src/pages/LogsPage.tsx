import { useEffect, useState, useRef } from "react";
import { getLogs, clearLogs, subscribeLogs, logFcmDiag } from "@/lib/logger";
import { registerFcmToken } from "@/lib/fcm";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";

export default function LogsPage() {
  const [, setTick] = useState(0);
  const [filter, setFilter] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const operator = useAuthStore((s) => s.operator);
  const isMobileApp = /Android/i.test(navigator.userAgent);

  useEffect(() => {
    const unsub = subscribeLogs(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const logs = getLogs();
  const filtered = filter
    ? logs.filter(
        (l) =>
          l.tag.toLowerCase().includes(filter.toLowerCase()) ||
          l.message.toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      case "debug": return "text-blue-400";
      default: return "text-gray-300";
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-gray-800 border-b border-gray-700 flex-wrap">
        {isMobileApp && (
          <button
            onClick={() => useNavigationStore.getState().setMobileView("chat-list")}
            className="px-2 py-1 bg-gray-700 text-white text-sm rounded"
          >
            ← Назад
          </button>
        )}
        <h1 className="text-lg font-bold mr-2">📋 Логи</h1>

        <input
          type="text"
          placeholder="Фильтр..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-2 py-1 rounded bg-gray-700 text-sm text-white border border-gray-600 w-40"
        />

        <button
          onClick={() => logFcmDiag()}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-500"
        >
          🔍 FCM Диагностика
        </button>

        <button
          onClick={() => {
            if (operator?.id) {
              console.log("[fcm] Manual trigger registerFcmToken for", operator.id);
              registerFcmToken(operator.id);
            } else {
              console.warn("[fcm] No operator logged in");
            }
          }}
          className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-500"
        >
          📤 Отправить FCM токен
        </button>

        <button
          onClick={() => {
            const androidFcm = (window as any).AndroidFCM;
            if (androidFcm) {
              const token = androidFcm.getToken();
              console.log("[fcm] Raw token:", token || "EMPTY");
            } else {
              console.log("[fcm] AndroidFCM not available");
            }
          }}
          className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-500"
        >
          🔑 Показать токен
        </button>

        <div className="flex-1" />

        <button
          onClick={clearLogs}
          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-500"
        >
          🗑 Очистить
        </button>

        <span className="text-xs text-gray-400">{filtered.length} записей</span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-auto p-2 font-mono text-xs leading-5">
        {filtered.map((log, i) => (
          <div key={i} className="flex gap-2 hover:bg-gray-800 px-1">
            <span className="text-gray-500 shrink-0">{log.time}</span>
            <span className={`shrink-0 w-12 ${levelColor(log.level)}`}>
              {log.level.toUpperCase()}
            </span>
            <span className="text-cyan-400 shrink-0">[{log.tag}]</span>
            <span className="text-gray-200 break-all">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}