import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/app";
import { AppProvider } from "@/providers/app-provider";

// Design system (порядок важен)
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/animations.css";
import "./styles/global.css";
import "@/lib/logger";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);

// Регистрация Service Worker для оффлайн-поддержки (только в браузере)
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("[Service Worker] Успешно зарегистрирован:", reg.scope))
      .catch((err) => console.error("[Service Worker] Ошибка регистрации:", err));
  });
}