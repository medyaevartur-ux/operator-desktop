import {
  Trash2, Shield, ShieldCheck, Crown,
  CheckSquare, Square, MessageSquareText,
  Clock, Star,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import type { ChatOperator } from "@/types/operator";
import s from "./OperatorCard.module.css";

const STATUS_LABELS: Record<string, string> = {
  online: "Онлайн",
  away: "Отошёл",
  dnd: "Не беспокоить",
  offline: "Офлайн",
};

const STATUS_DOT_CLASS: Record<string, string> = {
  online: "dotOnline",
  away: "dotAway",
  dnd: "dotDnd",
  offline: "dotOffline",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Админ",
  supervisor: "Супервайзер",
  operator: "Оператор",
};

function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Никогда";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "admin") return <Crown style={{ width: 14, height: 14, color: "var(--status-away)" }} />;
  if (role === "supervisor") return <ShieldCheck style={{ width: 14, height: 14, color: "var(--accent)" }} />;
  return <Shield style={{ width: 14, height: 14, color: "var(--text-disabled)" }} />;
}

function getDotClass(status: string): string {
  const key = STATUS_DOT_CLASS[status] ?? "dotOffline";
  return s[key] ?? "";
}

interface OperatorCardProps {
  op: ChatOperator;
  isSelf: boolean;
  bulkMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function OperatorCard({
  op, isSelf, bulkMode, isSelected,
  onToggleSelect, onEdit, onDelete,
}: OperatorCardProps) {
  const statusLabel = STATUS_LABELS[op.status ?? "offline"] ?? "Офлайн";
  const roleLabel = ROLE_LABELS[op.role ?? "operator"] ?? "Оператор";

  const cardClass = [
    s.card,
    isSelected && s.cardSelected,
    op.is_active === false && s.cardInactive,
  ].filter(Boolean).join(" ");

  const handleClick = () => (bulkMode ? onToggleSelect() : onEdit());
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={cardClass}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {bulkMode && (
        <div className={s.checkbox}>
          {isSelected ? (
            <CheckSquare className={s.checkboxSelected} style={{ width: 20, height: 20 }} />
          ) : (
            <Square className={s.checkboxUnselected} style={{ width: 20, height: 20 }} />
          )}
        </div>
      )}

      <div className={s.avatarWrap}>
        <div
          className={s.avatar}
          style={op.avatar_url ? { backgroundImage: `url(${API_BASE}${op.avatar_url})` } : undefined}
        >
          {!op.avatar_url && (op.name?.charAt(0).toUpperCase() ?? "?")}
        </div>
        <div className={`${s.statusDot} ${getDotClass(op.status ?? "offline")}`} />
      </div>

      <div className={s.info}>
        <div className={s.nameRow}>
          <span className={s.name}>{op.name || "—"}</span>
          {isSelf && <span className={s.selfBadge}>Вы</span>}
          <RoleIcon role={op.role ?? "operator"} />
          <span className={s.roleBadge}>{roleLabel}</span>
        </div>
        <div className={s.email}>{op.email}</div>
        <div className={s.metaRow}>
          <span className={s.metaItem}>
            <span className={`${s.metaDot} ${getDotClass(op.status ?? "offline")}`} />
            {statusLabel}
          </span>
          <span>·</span>
          <span className={s.metaItem}>
            <Clock style={{ width: 11, height: 11 }} />
            {formatLastSeen(op.last_seen_at)}
          </span>
        </div>
      </div>

      <div className={s.stats}>
        <div className={s.statActive}>
          <MessageSquareText style={{ width: 12, height: 12 }} />
          {op.current_chats_count ?? 0} активн.
        </div>
        <div className={s.statTotal}>Всего: {op.total_chats ?? 0}</div>
        <div className={s.statRating}>
          <Star style={{ width: 11, height: 11 }} />
          {(op.avg_rating ?? 0).toFixed(1)}
        </div>
      </div>

      {!bulkMode && !isSelf && (
        <button
          className={s.deleteBtn}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Удалить"
        >
          <Trash2 style={{ width: 14, height: 14 }} />
        </button>
      )}
    </div>
  );
}