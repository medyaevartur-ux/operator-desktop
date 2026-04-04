import { io, Socket } from "socket.io-client";
import { create } from "zustand";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3010";

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

export function getSocket(): Socket {
  if (!socket) {
    useSocketStore.getState().setStatus("connecting");

    socket = io(API_BASE, {
      path: "/ws",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    socket.on("connect", () => {
      console.log("[ws] connected:", socket?.id);
      useSocketStore.getState().setStatus("connected");
      useSocketStore.getState().setLastError(null);
    });

    socket.on("disconnect", (reason) => {
      console.log("[ws] disconnected:", reason);
      useSocketStore.getState().setStatus("disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error("[ws] error:", err.message);
      useSocketStore.getState().setStatus("error");
      useSocketStore.getState().setLastError(err.message);
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
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  useSocketStore.getState().setStatus("connecting");
  useSocketStore.getState().setLastError(null);
  return getSocket();
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  useSocketStore.getState().setStatus("disconnected");
}