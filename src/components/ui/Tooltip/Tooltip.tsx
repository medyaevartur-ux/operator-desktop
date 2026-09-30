import { useEffect, useRef, useState, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import s from "./Tooltip.module.css";

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  delayDuration?: number;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={100}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children, content, kbd, side = "top", delayDuration }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // Radix закрывает подсказку, когда курсор уходит с кнопки. Но заблокированная кнопка
  // («Отправить» после отправки по Enter) и системное окно выбора файла этого не сообщают,
  // и подсказка оставалась висеть. Закрываем её при любом явном действии вокруг.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const leave = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node)) close(); };
    window.addEventListener("blur", close);
    document.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("pointermove", leave, true);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("blur", close);
      document.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("pointermove", leave, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild ref={trigger}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={s.content}
          side={side}
          sideOffset={6}
          collisionPadding={8}
        >
          {content}
          {kbd && <span className={s.kbd}>{kbd}</span>}
          <TooltipPrimitive.Arrow className={s.arrow} width={8} height={4} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
