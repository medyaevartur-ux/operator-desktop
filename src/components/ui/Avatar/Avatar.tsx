import { getAvatarTone, getInitials } from "@/utils/avatar";
import s from "./Avatar.module.css";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type AvatarStatus = "online" | "away" | "dnd" | "offline";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  status?: AvatarStatus;
  className?: string;
}

const STATUS_LABEL: Record<AvatarStatus, string> = {
  online: "в сети",
  away: "отошёл",
  dnd: "не беспокоить",
  offline: "не в сети",
};

export function Avatar({ name, src, size = "md", status, className }: AvatarProps) {
  return (
    <span className={[s.wrapper, s[size], className].filter(Boolean).join(" ")}>
      <span className={s.avatar} data-tone={src ? undefined : getAvatarTone(name)} aria-hidden="true">
        {src ? <img src={src} alt="" className={s.image} loading="lazy" /> : getInitials(name)}
      </span>
      {status && <span className={s.statusDot} data-status={status} title={STATUS_LABEL[status]} />}
    </span>
  );
}
