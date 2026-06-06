import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/app";
import { AppProvider } from "@/providers/app-provider";

// Design system (порядок важен)
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/animations.css";
import "./styles/global.css";
import "./styles/md3/index.css"; // MD3 дизайн-система (токены/шрифты), редизайн Трек B
import "@/lib/logger";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);

// Регистрация Service Worker для оффлайн-поддержки (только в стандартном браузере, не в Tauri)
const isTauri =
  typeof window !== "undefined" &&
  (window.location.protocol === "tauri:" ||
    window.location.hostname === "tauri.localhost" ||
    (window as any).__TAURI_INTERNALS__ !== undefined);

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  if (isTauri) {
    // В Tauri оффлайн-режим работает из коробки за счет встраивания файлов в дистрибутив.
    // Наличие Service Worker может блокировать кастомные протоколы tauri:// и tauri.localhost.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((success) => {
          if (success) {
            console.log("[Service Worker] Успешно удален из Tauri для предотвращения конфликтов");
          }
        });
      }
    });
  } else {
    window.addEventListener("load", () => {
      // Версия в query-параметре заставляет браузер переустановить SW при каждом релизе,
      // а сам SW формирует из неё имя кэша и чистит устаревшие версии на activate.
      navigator.serviceWorker
        .register(`/sw.js?v=${__APP_VERSION__}`)
        .then((reg) => console.log("[Service Worker] Успешно зарегистрирован:", reg.scope))
        .catch((err) => console.error("[Service Worker] Ошибка регистрации:", err));
    });
  }
}