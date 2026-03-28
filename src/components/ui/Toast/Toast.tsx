import { useEffect, useState, useCallback, type ReactNode } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { create } from "zustand";
import s from "./Toast.module.css";

/* ── Store ── */

type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id">) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
  },
  remove: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/* Shorthand */
export const toast = {
  success: (title: string, message?: string) =>
    useToastStore.getState().add({ type: "success", title, message }),
  error: (title: string, message?: string) =>
    useToastStore.getState().add({ type: "error", title, message }),
  warning: (title: string, message?: string) =>
    useToastStore.getState().add({ type: "warning", title, message }),
  info: (title: string, message?: string) =>
    useToastStore.getState().add({ type: "info", title, message }),
};

/* ── Icons ── */

const ICON_MAP: Record<ToastType, ReactNode> = {
  success: <CheckCircle style={{ width: 16, height: 16 }} />,
  error: <XCircle style={{ width: 16, height: 16 }} />,
  warning: <AlertTriangle style={{ width: 16, height: 16 }} />,
  info: <Info style={{ width: 16, height: 16 }} />,
};

const ICON_CLASS: Record<ToastType, string> = {
  success: s.iconSuccess,
  error: s.iconError,
  warning: s.iconWarning,
  info: s.iconInfo,
};

/* ── Single Toast ── */

function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const duration = item.duration ?? 4000;
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onRemove, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [item.duration, onRemove]);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(onRemove, 200);
  }, [onRemove]);

  return (
    <div className={`${s.toast} ${exiting ? s.toastExiting : ""}`}>
      <div className={`${s.iconWrapper} ${ICON_CLASS[item.type]}`}>
        {ICON_MAP[item.type]}
      </div>
      <div className={s.content}>
        <div className={s.title}>{item.title}</div>
        {item.message && <div className={s.message}>{item.message}</div>}
      </div>
      <button className={s.closeBtn} onClick={handleClose} aria-label="Закрыть">
        <X style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}

/* ── Container (mount once in App) ── */

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div className={s.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onRemove={() => remove(t.id)} />
      ))}
    </div>
  );
}