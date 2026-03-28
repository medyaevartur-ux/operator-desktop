import { useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Trash2, Info } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/Button/Button";
import s from "./ConfirmDialog.module.css";

/* ── Types ── */

type ConfirmVariant = "danger" | "warning" | "info";

interface ConfirmOptions {
  title: string;
  description?: string;
  /** @deprecated use description */
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  /** @deprecated use variant="danger" */
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions;
  resolve: ((value: boolean) => void) | null;
  show: (options: ConfirmOptions) => Promise<boolean>;
  close: (result: boolean) => void;
}

/* ── Store ── */

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: { title: "" },
  resolve: null,

  show: (options) => {
    return new Promise<boolean>((resolve) => {
      set({ open: true, options, resolve });
    });
  },

  close: (result) => {
    const { resolve } = get();
    resolve?.(result);
    set({ open: false, resolve: null });
  },
}));

/* ── Hook (compatible with old { confirm } pattern) ── */

export function useConfirm() {
  const show = useConfirmStore((s) => s.show);

  const confirm = useCallback(
    (options: ConfirmOptions) => show(options),
    [show]
  );

  return { confirm };
}

/* ── Icons ── */

const ICON_MAP: Record<ConfirmVariant, React.ReactNode> = {
  danger: <Trash2 style={{ width: 20, height: 20 }} />,
  warning: <AlertTriangle style={{ width: 20, height: 20 }} />,
  info: <Info style={{ width: 20, height: 20 }} />,
};

const ICON_CLASS: Record<ConfirmVariant, string> = {
  danger: s.iconDanger,
  warning: s.iconWarning,
  info: s.iconInfo,
};

/* ── Component ── */

export function ConfirmDialog() {
  const { open, options, close } = useConfirmStore();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Support legacy `danger` boolean and `message` field
  const variant: ConfirmVariant = options.variant ?? (options.danger ? "danger" : "warning");
  const description = options.description ?? options.message;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) close(false);
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className={s.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>

            <Dialog.Content
              asChild
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <motion.div
                className={s.overlay}
                style={{ background: "transparent" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className={s.content}
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] as const }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={s.header}>
                    <div className={`${s.iconWrapper} ${ICON_CLASS[variant]}`}>
                      {ICON_MAP[variant]}
                    </div>
                    <div>
                      <Dialog.Title className={s.title}>{options.title}</Dialog.Title>
                    </div>
                  </div>

                  {description && (
                    <div className={s.body}>
                      <Dialog.Description className={s.description}>
                        {description}
                      </Dialog.Description>
                    </div>
                  )}

                  <div className={s.footer}>
                    <Button
                      ref={cancelRef}
                      variant="secondary"
                      size="md"
                      onClick={() => close(false)}
                    >
                      {options.cancelText ?? "Отмена"}
                    </Button>
                    <Button
                      variant={variant === "danger" ? "danger" : "primary"}
                      size="md"
                      onClick={() => close(true)}
                      autoFocus={false}
                    >
                      {options.confirmText ?? "Подтвердить"}
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}