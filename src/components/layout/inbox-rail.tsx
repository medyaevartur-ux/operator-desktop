import {
  MessageSquareText,
  Settings,
  Users,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  ListOrdered,
  Eye,
  Palette,  
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useNotificationStore } from "@/store/notification.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { Tooltip } from "@/components/ui";
import { getInitials } from "@/utils/avatar";
import s from "./InboxRail.module.css";

const ALL_NAV_ITEMS = [
  { icon: MessageSquareText, label: "Чаты", screen: "inbox" as const, roles: ["admin", "supervisor", "operator"] },
  { icon: ListOrdered, label: "Очередь", screen: "queue" as const, roles: ["admin", "supervisor", "operator"] },
  { icon: Eye, label: "Посетители", screen: "visitors" as const, roles: ["admin", "supervisor"] },
  { icon: Users, label: "Операторы", screen: "operators" as const, roles: ["admin"] },
  { icon: Settings, label: "Настройки", screen: "settings" as const, roles: ["admin", "supervisor"] },
  { icon: Palette, label: "Виджет", screen: "widget_settings" as const, roles: ["admin"] },  
];

const STATUS_OPTIONS: Array<{
  value: "online" | "away" | "dnd" | "offline";
  label: string;
  color: string;
}> = [
  { value: "online", label: "Онлайн", color: "var(--status-online)" },
  { value: "away", label: "Отошёл", color: "var(--status-away)" },
  { value: "dnd", label: "Не беспокоить", color: "var(--status-dnd)" },
  { value: "offline", label: "Офлайн", color: "var(--status-offline)" },
];

function getStatusColor(status: string | null) {
  return STATUS_OPTIONS.find((o) => o.value === status)?.color ?? "var(--status-online)";
}

export function InboxRail() {
  const sessions = useInboxStore((st) => st.sessions);
  const operator = useAuthStore((st) => st.operator);
  const updateOperatorStatus = useAuthStore((st) => st.updateOperatorStatus);
  const unreadTotal = sessions.reduce((acc, ses) => acc + (ses.unread_count ?? 0), 0);
  const queueCount = sessions.filter(
    (ses) => ses.status === "waiting_operator" && !ses.operator_id
  ).length;
  const currentStatus = operator?.status ?? "online";
  const userRole = operator?.role ?? "operator";
  const NAV_ITEMS = ALL_NAV_ITEMS.filter((item) => item.roles.includes(userRole));

  const screen = useNavigationStore((st) => st.screen);
  const setScreen = useNavigationStore((st) => st.setScreen);
  const visitorOnlineCount = useVisitorsStore((st) => st.onlineCount);
  const soundEnabled = useNotificationStore((st) => st.soundEnabled);
  const setSoundEnabled = useNotificationStore((st) => st.setSoundEnabled);
  const desktopEnabled = useNotificationStore((st) => st.desktopEnabled);
  const setDesktopEnabled = useNotificationStore((st) => st.setDesktopEnabled);

  return (
    <aside className={s.rail}>
      {/* ── Аватар оператора + Dropdown статус ── */}
      <DropdownMenu.Root>
        <Tooltip content={`${operator?.name ?? "Оператор"} — ${currentStatus}`} side="right">
          <DropdownMenu.Trigger asChild>
            <button className={s.avatarBtn} type="button">
              {operator?.avatar_url ? (
                <img
                  src={operator.avatar_url}
                  alt={operator.name ?? ""}
                  className={s.avatarImg}
                />
              ) : (
                getInitials(operator?.name ?? "?")
              )}
              <div
                className={s.avatarDot}
                style={{ background: getStatusColor(currentStatus) }}
              />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>

        <DropdownMenu.Portal>
          <DropdownMenu.Content className={s.dropdownContent} side="right" sideOffset={8} align="start">
            <div className={s.dropdownLabel}>{operator?.name ?? "Оператор"}</div>
            {STATUS_OPTIONS.map((opt) => (
              <DropdownMenu.Item
                key={opt.value}
                className={`${s.dropdownItem} ${currentStatus === opt.value ? s.dropdownItemActive : ""}`}
                onSelect={() => void updateOperatorStatus(opt.value)}
              >
                <span className={s.statusDot} style={{ background: opt.color }} />
                {opt.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* ── Навигация ── */}
      <div className={s.nav}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = screen === item.screen;
          const showBadge = item.screen === "inbox" && unreadTotal > 0;

          const showQueueBadge = item.screen === "queue" && queueCount > 0;
          const showVisitorBadge = item.screen === "visitors";
          return (
            <Tooltip key={item.screen} content={item.label} side="right">
              <button
                type="button"
                className={`${s.navBtn} ${isActive ? s.navBtnActive : ""}`}
                onClick={() => setScreen(item.screen)}
              >
                <Icon style={{ width: 20, height: 20 }} />
                {showBadge && (
                  <span className={s.badge}>
                    {unreadTotal > 99 ? "99+" : unreadTotal}
                  </span>
                )}
                {showQueueBadge && (
                  <span className={s.badgeQueue}>
                    {queueCount > 99 ? "99+" : queueCount}
                  </span>
                )}
                {showVisitorBadge && visitorOnlineCount > 0 && (
                  <span className={s.badgeQueue} style={{ background: '#10b981' }}>
                    {visitorOnlineCount > 99 ? "99+" : visitorOnlineCount}
                  </span>
                )}                
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* ── Уведомления ── */}
      <div className={s.bottom}>
        <Tooltip content={soundEnabled ? "Звук: вкл" : "Звук: выкл"} side="right">
          <button
            type="button"
            className={`${s.notifBtn} ${soundEnabled ? s.notifBtnActive : s.notifBtnInactive}`}
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled
              ? <Volume2 style={{ width: 16, height: 16 }} />
              : <VolumeX style={{ width: 16, height: 16 }} />}
          </button>
        </Tooltip>

        <Tooltip content={desktopEnabled ? "Уведомления: вкл" : "Уведомления: выкл"} side="right">
          <button
            type="button"
            className={`${s.notifBtn} ${desktopEnabled ? s.notifBtnActive : s.notifBtnInactive}`}
            onClick={() => setDesktopEnabled(!desktopEnabled)}
          >
            {desktopEnabled
              ? <Bell style={{ width: 16, height: 16 }} />
              : <BellOff style={{ width: 16, height: 16 }} />}
          </button>
        </Tooltip>
      </div>

      {/* ── Quick status toggle ── */}
      <Tooltip content={currentStatus === "online" ? "Стать Away" : "Стать Online"} side="right">
        <button
          type="button"
          className={s.statusToggle}
          style={{ background: getStatusColor(currentStatus) }}
          onClick={() => {
            const next = currentStatus === "online" ? "away" : "online";
            void updateOperatorStatus(next);
          }}
        >
          <div className={`${s.statusThumb} ${currentStatus === "online" ? s.statusThumbOn : ""}`} />
        </button>
      </Tooltip>
    </aside>
  );
}