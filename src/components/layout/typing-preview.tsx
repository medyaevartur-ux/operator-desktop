import { useState, useEffect, useRef } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { AnimatePresence, motion } from "framer-motion";
import s from "./TypingPreview.module.css";

const AUTO_HIDE_MS = 5000;

export function TypingPreview({ sessionId }: { sessionId: string }) {
  const preview = useInboxStore((st) => st.typingPreviews[sessionId]);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (preview?.isTyping && preview.text) {
      setVisible(true);

      // Auto-hide after 5 sec without updates
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, AUTO_HIDE_MS);
    } else {
      setVisible(false);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [preview?.isTyping, preview?.text, preview?.updatedAt]);

  const text = preview?.text || "";

  return (
    <AnimatePresence>
      {visible && text && (
        <motion.div
          className={s.container}
          initial={{ opacity: 0, y: 10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 10, height: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={s.inner}>
            <div className={s.dots}>
              <span className={s.dot} />
              <span className={s.dot} />
              <span className={s.dot} />
            </div>
            <div className={s.label}>Клиент печатает:</div>
            <div className={s.text}>{text}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}