import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";

const TYPING_TIMEOUT = 3000;

export function useTypingIndicator() {
  const activeSession = useInboxStore((s) => s.activeSession);
  const operator = useAuthStore((s) => s.operator);
  const [isVisitorTyping, setIsVisitorTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeSession?.id) {
      setIsVisitorTyping(false);
      return;
    }

    const socket = getSocket();

    const handleTyping = (data: { sessionId: string; sender: string }) => {
      if (data.sessionId === activeSession.id && data.sender === "visitor") {
        setIsVisitorTyping(true);

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        typingTimeoutRef.current = setTimeout(() => {
          setIsVisitorTyping(false);
        }, TYPING_TIMEOUT);
      }
    };

    socket.on("typing", handleTyping);

    return () => {
      socket.off("typing", handleTyping);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setIsVisitorTyping(false);
    };
  }, [activeSession?.id]);

  const sendTyping = useCallback(() => {
    if (!activeSession?.id || !operator?.id) return;

    const socket = getSocket();
    socket.emit("typing", {
      sessionId: activeSession.id,
      sender: "operator",
    });
  }, [activeSession?.id, operator?.id]);

  return { isVisitorTyping, sendTyping };
}