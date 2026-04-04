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