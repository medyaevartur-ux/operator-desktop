import { io, Socket } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3010";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, {
      path: "/ws",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[ws] connected:", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[ws] disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("[ws] error:", err.message);
    });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}