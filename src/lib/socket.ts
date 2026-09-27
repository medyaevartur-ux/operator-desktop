import { io, Socket } from "socket.io-client";
import { create } from "zustand";
import { API_BASE } from "./api-config";
import { accessToken, getSession } from "./auth-session";

// ── Socket state store ──
interface SocketState {
  status: "connected" | "connecting" | "disconnected" | "error";
  setStatus: (s: SocketState["status"]) => void;
  lastError: string | null;
  setLastError: (e: string | null) => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
  lastError: null,
  setLastError: (lastError) => set({ lastError }),
}));

let socket: Socket | null = null;
let removeRecoveryListeners: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function bindConnectionRecovery() {
  const recover = () => {
    if (socket && !socket.connected && navigator.onLine) socket.connect();
  };
  const onVisible = () => { if (!document.hidden) recover(); };
  window.addEventListener("online", recover);
  window.addEventListener("focus", recover);
  window.addEventListener("pageshow", recover);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("online", recover);
    window.removeEventListener("focus", recover);
    window.removeEventListener("pageshow", recover);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function getSocket(): Socket {
  if (!socket) {
    useSocketStore.getState().setStatus("connecting");

    socket = io(API_BASE, {
      path: "/ws",
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      // Read at each handshake so a re-login never reuses the previous JWT.
      auth: (callback) => { void accessToken().then(token => callback({ token })).catch(() => callback({ token: "expired" })); },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    removeRecoveryListeners = bindConnectionRecovery();

    socket.on("connect", () => {
      clearTimeout(retryTimer);
      console.log("[ws] connected:", socket?.id);
      useSocketStore.getState().setStatus("connected");
      useSocketStore.getState().setLastError(null);
    });

    socket.on("disconnect", (reason) => {
      console.log("[ws] disconnected:", reason);
      useSocketStore.getState().setStatus("disconnected");
      if (reason === "io server disconnect" && getSession()) {
        retryTimer = setTimeout(() => { void accessToken(true).then(() => socket?.connect()).catch(() => undefined); }, 1000);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[ws] error:", err.message);
      useSocketStore.getState().setStatus("error");
      useSocketStore.getState().setLastError(err.message);
      clearTimeout(retryTimer);
      if (getSession()) retryTimer = setTimeout(() => {
        void accessToken(/Unauthorized/i.test(err.message)).then(() => socket?.connect()).catch(() => undefined);
      }, 5000);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      console.log("[ws] reconnect attempt:", attempt);
      useSocketStore.getState().setStatus("connecting");
    });

    socket.io.on("reconnect_failed", () => {
      console.error("[ws] reconnect failed");
      useSocketStore.getState().setStatus("error");
      useSocketStore.getState().setLastError("Не удалось переподключиться");
    });
  }

  return socket;
}

export function reconnectSocket() {
  useSocketStore.getState().setStatus("connecting");
  useSocketStore.getState().setLastError(null);
  // React hooks retain this instance and its listeners. Replacing it silently
  // disconnects the UI from all subsequent message/session events.
  if (!socket) return getSocket();
  socket.disconnect();
  socket.connect();
  return socket;
}

export function disconnectSocket() {
  clearTimeout(retryTimer);
  removeRecoveryListeners?.();
  removeRecoveryListeners = null;
  if (socket) {
    socket.disconnect();
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket = null;
  }
  useSocketStore.getState().setStatus("disconnected");
}
