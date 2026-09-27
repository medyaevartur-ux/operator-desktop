import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/app";
import { AppProvider } from "@/providers/app-provider";

// Design system (порядок важен): токены → сброс → роли MD3 → общие правила
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/md3/index.css";
import "./styles/animations.css";
import "./styles/global.css";
import "@/lib/logger";
// Тема и плотность применяются до первого кадра, в том числе на экране входа.
import "@/store/theme.store";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);

import { registerOperatorWorker } from "@/lib/pwa";
void registerOperatorWorker();
