import { Bell, ChartColumn, ChevronRight, Eye, LogOut, MessageSquareQuote, Monitor, Moon, Settings, Stethoscope, Sun, Users, Volume2 } from "lucide-react";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore, type Screen, type MobileView } from "@/store/navigation.store";
import { useNotificationStore } from "@/store/notification.store";
import { useDeliveryStore } from "@/store/delivery.store";
import { useThemeStore, type Theme } from "@/store/theme.store";
import { Avatar, Toggle } from "@/components/ui";
import { env } from "@/lib/env";
import { STATUS_OPTIONS, type OperatorStatus } from "./sidebar";
import s from "./MobileMore.module.css";

const SECTIONS: Array<{ screen: Screen; view: MobileView; label: string; icon: typeof Eye; manager?: boolean }> = [
  { screen: "visitors", view: "workspace", label: "Посетители на сайте", icon: Eye, manager: true },
  { screen: "operators", view: "workspace", label: "Команда", icon: Users, manager: true },
  { screen: "dashboard", view: "workspace", label: "Статистика", icon: ChartColumn, manager: true },
  { screen: "widget_settings", view: "workspace", label: "Виджет на сайте", icon: MessageSquareQuote, manager: true },
  { screen: "settings", view: "settings", label: "Настройки", icon: Settings },
  { screen: "logs", view: "logs", label: "Диагностика уведомлений", icon: Stethoscope },
];
const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "system", label: "Системная", icon: Monitor },
];

export function MobileMore() {
  const operator = useAuthStore(state => state.operator);
  const updateStatus = useAuthStore(state => state.updateOperatorStatus);
  const logout = useAuthStore(state => state.logout);
  const sound = useNotificationStore(state => state.soundEnabled);
  const setSound = useNotificationStore(state => state.setSoundEnabled);
  const alerts = useDeliveryStore(state => state.preferences.enabled);
  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);
  const manager = operator?.role === "admin" || operator?.role === "supervisor";
  const status = (operator?.status ?? "online") as OperatorStatus;
  const open = (item: typeof SECTIONS[number]) => useNavigationStore.setState({ screen: item.screen, mobileView: item.view });
  const src = operator?.avatar_url ? (operator.avatar_url.startsWith("http") ? operator.avatar_url : `${env.apiUrl}${operator.avatar_url}`) : null;

  return (
    <div className={s.page}>
      <section className={s.profile}>
        <Avatar name={operator?.name ?? "Оператор"} src={src} size="lg" status={status} />
        <div>
          <strong>{operator?.name ?? "Оператор"}</strong>
          <span>{operator?.email}</span>
        </div>
      </section>

      <div className={s.statuses} role="radiogroup" aria-label="Мой статус">
        {STATUS_OPTIONS.map(option => (
          <button key={option.value} type="button" role="radio" aria-checked={status === option.value} onClick={() => void updateStatus(option.value).catch(() => undefined)}>
            <i data-status={option.value} />{option.label}
          </button>
        ))}
      </div>

      <section className={s.group}>
        {SECTIONS.filter(item => manager || !item.manager).map(item => (
          <button key={item.screen} type="button" className={s.row} onClick={() => open(item)}>
            <item.icon className={s.rowIcon} /><span>{item.label}</span><ChevronRight className={s.chevron} />
          </button>
        ))}
      </section>

      <section className={s.group}>
        <div className={s.toggleRow}><Volume2 className={s.rowIcon} /><Toggle checked={sound} onChange={setSound} label="Звук новых сообщений" /></div>
        <div className={s.toggleRow}><Bell className={s.rowIcon} /><Toggle checked={alerts} label="Уведомления" onChange={enabled => {
          const store = useDeliveryStore.getState();
          void store.savePreferences({ ...store.preferences, enabled }).catch(() => undefined);
        }} /></div>
      </section>

      <div className={s.themes} role="radiogroup" aria-label="Оформление">
        {THEMES.map(item => (
          <button key={item.value} type="button" role="radio" aria-checked={theme === item.value || (theme === "fairytale" && item.value === "light")} onClick={() => setTheme(item.value)}>
            <item.icon />{item.label}
          </button>
        ))}
      </div>

      <button type="button" className={s.logout} onClick={() => void logout()}><LogOut />Выйти</button>
      <p className={s.version}>Версия {__APP_VERSION__}</p>
    </div>
  );
}
