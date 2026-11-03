import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import s from "./Tooltip.module.css";

// Подсказки нужны только там, где есть настоящее наведение мышью. На телефоне (касание, S Pen)
// их нечем «увести», и они висели поверх кнопок.
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const subscribeHover = (notify: () => void) => {
  const query = window.matchMedia(HOVER_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const canHover = () => window.matchMedia(HOVER_QUERY).matches;

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  delayDuration?: number;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  // Подсказки не интерактивные. Без disableHoverableContent Radix после ухода курсора с кнопки
  // ждёт следующего движения мыши в окне — у края окна его нет, и подсказка оставалась висеть.
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={100} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children, content, kbd, side = "top", delayDuration }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverable = useSyncExternalStore(subscribeHover, canHover, () => true);

  // Закрывшееся меню (быстрые ответы, эмодзи, форматирование) возвращает фокус на свою кнопку,
  // и Radix открывал подсказку без курсора над ней. Открываем только под курсором или с клавиатуры.
  const handleOpenChange = (next: boolean) => {
    if (next && !trigger.current?.matches(":hover, :focus-visible")) return;
    setOpen(next);
  };

  // Radix закрывает подсказку, когда курсор уходит с кнопки. Но заблокированная кнопка
  // («Отправить» после отправки по Enter) и системное окно выбора файла этого не сообщают,
  // и подсказка оставалась висеть. Закрываем её при любом явном действии вокруг,
  // в том числе когда курсор ушёл за окно приложения (pointerout без relatedTarget).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (node: EventTarget | null) => !(node instanceof Node && trigger.current?.contains(node));
    const move = (event: PointerEvent) => { if (outside(event.target)) close(); };
    const out = (event: PointerEvent) => { if (outside(event.relatedTarget)) close(); };
    window.addEventListener("blur", close);
    document.addEventListener("keydown", close, true);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("blur", close);
      document.removeEventListener("keydown", close, true);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!hoverable) return <>{children}</>;

  return (
    <TooltipPrimitive.Root open={open} onOpenChange={handleOpenChange} delayDuration={delayDuration}>
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
