import { getAvatarGradient, getInitials } from "@/utils/avatar";
import s from "./Avatar.module.css";

type AvatarSize = "sm" | "md" | "lg" | "xl";
type AvatarStatus = "online" | "away" | "dnd" | "offline";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  status?: AvatarStatus;
  className?: string;
}

const STATUS_CLASS: Record<AvatarStatus, string> = {
  online: s.statusOnline,
  away: s.statusAway,
  dnd: s.statusDnd,
  offline: s.statusOffline,
};

export function Avatar({ name, src, size = "md", status, className }: AvatarProps) {
  const wrapperClass = [s.wrapper, s[size], className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass}>
      <div
        className={s.avatar}
        style={!src ? { background: getAvatarGradient(name) } : undefined}
      >
        {src ? (
          <img src={src} alt={name} className={s.image} loading="lazy" />
        ) : (
          getInitials(name)
        )}
      </div>
      {status && (
        <span className={`${s.statusDot} ${STATUS_CLASS[status] || STATUS_CLASS.offline}`} />
      )}
    </div>
  );
}