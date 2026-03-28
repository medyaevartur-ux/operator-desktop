import { type ReactNode } from "react";
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
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
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