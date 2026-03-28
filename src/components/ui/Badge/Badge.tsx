import type { ReactNode } from "react";
import s from "./Badge.module.css";

type BadgeVariant = "default" | "accent" | "success" | "warning" | "error" | "info" | "unread";
type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children?: ReactNode;
  className?: string;
}

export function Badge({ variant = "default", size = "sm", children, className }: BadgeProps) {
  const classes = [s.badge, s[variant], s[size], className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}

/* Status dot */
type StatusDotStatus = "online" | "away" | "dnd" | "offline";

interface StatusDotProps {
  status: StatusDotStatus;
  className?: string;
}

const DOT_MAP: Record<StatusDotStatus, string> = {
  online: s.dotOnline,
  away: s.dotAway,
  dnd: s.dotDnd,
  offline: s.dotOffline,
};

export function StatusDot({ status, className }: StatusDotProps) {
  const classes = [s.badge, s.dot, DOT_MAP[status] || DOT_MAP.offline, className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} />;
}