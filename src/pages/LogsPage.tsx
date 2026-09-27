import { useCallback, useEffect, useState } from "react";
import {
  Activity, Bell, CircleAlert, CircleCheck, CircleDashed, Download, Info, Laptop, RefreshCw, Search,
  Send, ShieldCheck, Smartphone, Trash2,
} from "lucide-react";
import { getLogs, clearLogs, subscribeLogs } from "@/lib/logger";
import { startDeviceRegistration } from "@/lib/fcm";
import { requestPushPermission } from "@/lib/pwa";
import { readDeviceDiagnostics, openSystemSettings, type DeviceDiagnostics } from "@/lib/tauri-bridge";
import { offlineQueue, type OfflineMessage } from "@/lib/offline-queue";
import { useOutbox } from "@/features/inbox/use-outbox";
import { pickConversation } from "@/lib/open-conversation";
import { isAndroid, isNative } from "@/lib/api-config";
import { useAuthStore } from "@/store/auth.store";
import { useInboxStore } from "@/store/inbox.store";
import { useSocketStore, reconnectSocket } from "@/lib/socket";
import { useDeliveryStore, type Device, type DeliveryLog } from "@/store/delivery.store";
import { getSession } from "@/lib/auth-session";
import { getSessionDisplayName } from "@/utils/avatar";
import { Button, toast } from "@/components/ui";
import s from "./LogsPage.module.css";

type Level = "ok" | "warn" | "fail" | "info" | "wait";
interface CheckItem { key: string; level: Level; title: string; detail: string; action?: { label: string; run: () => void } }

const STATUS_LABELS: Record<string, string> = { pending: "Ожидает отправки", sent: "Отправлено, ждём подтверждения", acked: "Подтверждено устройством", failed: "Не доставлено", cancelled: "Не понадобилось" };
const ERROR_LABELS: Record<string, string> = {
  device_offline: "Приложение на устройстве было закрыто", provider_not_configured: "Канал уведомлений не настроен на сервере",
  notification_permission_denied: "Уведомления запрещены на устройстве", not_acknowledged: "Устройство не подтвердило получение",
  dnd: "Тихий режим", disabled: "Уведомления выключены в настройках", device_inactive: "Устройство отключено",
  no_longer_actionable: "Уже прочитано или диалог завершён", event_disabled: "Этот тип уведомлений выключен",
  webpush_unavailable: "Web Push недоступен", provider_unavailable: "Служба уведомлений временно недоступна",
};
const OUTCOME_LABELS: Record<string, string> = { displayed: "показано", opened: "открыто", read: "прочитано", blocked: "заблокировано", suppressed: "тихий режим" };
const errorLabel = (code?: string | null) => (code ? ERROR_LABELS[code] || (code.startsWith("messaging/") || code.startsWith("invalid") ? "Устройство не приняло уведомление" : code) : "");
/** Статус строки журнала и пояснение; «устройство не на связи» читается по-разному, пока ждём и когда сдались. */
function deliveryState(item: DeliveryLog): [string, string] {
  if (item.error_code === "device_offline" && item.status === "pending") return ["Ждёт запуска приложения", "Доставим, как только устройство выйдет на связь (до 24 ч)"];
  if (item.error_code === "device_offline" && item.status === "cancelled") return ["Не доставлено", "Устройство не выходило на связь 24 ч"];
  const main = STATUS_LABELS[item.status] || item.status;
  return [item.ack_outcome && item.status === "acked" ? `${main} · ${OUTCOME_LABELS[item.ack_outcome] || item.ack_outcome}` : main, errorLabel(item.error_code)];
}
const when = (value?: string | null) => (value ? new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const LEVEL_ICON: Record<Level, typeof Info> = { ok: CircleCheck, warn: CircleAlert, fail: CircleAlert, info: Info, wait: CircleDashed };

function Check({ item }: { item: CheckItem }) {
  const Icon = LEVEL_ICON[item.level];
  return (
    <li className={s.check} data-level={item.level}>
      <Icon className={s.checkIcon} aria-hidden="true" />
      <div className={s.checkText}><strong>{item.title}</strong><span>{item.detail}</span></div>
      {item.action && <Button size="sm" variant="secondary" onClick={item.action.run}>{item.action.label}</Button>}
    </li>
  );
}

function deviceChecks(input: {
  socket: string; device?: Device; report: DeviceDiagnostics | null; enabled: boolean; quiet: boolean; dnd: boolean;
  outbox: OfflineMessage[]; register: () => void; allow: () => void; toggleAlerts: () => void;
}): CheckItem[] {
  const { socket, device, report } = input;
  const checks: CheckItem[] = [];
  checks.push(socket === "connected"
    ? { key: "socket", level: "ok", title: "Связь с сервером есть", detail: "Новые сообщения приходят сразу." }
    : { key: "socket", level: socket === "connecting" ? "wait" : "fail", title: socket === "connecting" ? "Подключаемся к серверу" : "Нет связи с сервером", detail: "Сообщения и уведомления придут, когда связь восстановится.", action: { label: "Переподключить", run: () => reconnectSocket() } });
  checks.push(getSession()
    ? { key: "session", level: "ok", title: "Вход выполнен", detail: "Сеанс защищён и продлевается автоматически." }
    : { key: "session", level: "fail", title: "Нужно войти снова", detail: "Без входа уведомления не приходят." });

  if (!device) checks.push({ key: "device", level: "fail", title: "Устройство не зарегистрировано для уведомлений", detail: "Сервер не знает, куда отправлять уведомления.", action: { label: "Зарегистрировать", run: input.register } });
  else if (!device.enabled) checks.push({ key: "device", level: "fail", title: "Сервер отключил доставку на это устройство", detail: errorLabel(device.last_error) || "Обычно после смены токена или ошибок доставки.", action: { label: "Подключить снова", run: input.register } });
  else if (device.provider === "fcm") checks.push({ key: "device", level: "ok", title: "Уведомления через Firebase", detail: "Приходят даже когда приложение закрыто. В уведомлении нет текста переписки — детали загружаются после входа." });
  else if (device.provider === "webpush") checks.push({ key: "device", level: "ok", title: "Уведомления браузера (Web Push)", detail: "Приходят, пока браузер запущен." });
  else checks.push({ key: "device", level: "info", title: isNative() ? "Уведомления, пока приложение запущено" : "Уведомления, пока вкладка открыта", detail: isNative() ? "Свёрнутое в трей приложение уведомления получает. После «Закрыть полностью» — нет: Windows не будит закрытое приложение." : "Закройте вкладку — уведомления перестанут приходить. Для фоновых уведомлений нужна установленная версия." });

  if (!report) checks.push({ key: "permission", level: "wait", title: "Проверяем разрешение устройства", detail: "" });
  else if (report.permission === "granted") checks.push({ key: "permission", level: report.channel_enabled === false ? "fail" : "ok", title: report.channel_enabled === false ? "Канал «Сообщения чата» выключен" : "Уведомления разрешены на устройстве", detail: report.channel_enabled === false ? "Включите канал в настройках уведомлений приложения." : "Система показывает уведомления приложения.", action: report.channel_enabled === false ? { label: "Открыть настройки", run: () => void openSystemSettings("notifications") } : undefined });
  else if (report.permission === "denied") checks.push({ key: "permission", level: "fail", title: "Уведомления запрещены на устройстве", detail: report.toast_setting === "disabled_by_group_policy" ? "Запрещены политикой организации — обратитесь к администратору компьютера." : isNative() ? "Разрешите их в системных настройках — иначе новые сообщения можно пропустить." : "Нажмите значок слева от адреса сайта → Уведомления → Разрешить, затем «Проверить снова».", action: isNative() ? { label: "Открыть настройки", run: () => void openSystemSettings("notifications").then(ok => { if (!ok) toast.info("Откройте настройки уведомлений вручную"); }) } : undefined });
  else if (report.permission === "default") checks.push({ key: "permission", level: "warn", title: "Уведомления ещё не разрешены", detail: "Браузер спросит разрешение один раз.", action: { label: "Разрешить", run: input.allow } });
  else checks.push({ key: "permission", level: "info", title: "Разрешение устройства неизвестно", detail: "Эта платформа не сообщает состояние уведомлений." });

  if (isAndroid() && report) {
    if (report.background_restricted) checks.push({ key: "battery", level: "fail", title: "Работа в фоне ограничена", detail: "Android может не доставлять уведомления вовремя. Снимите ограничение для «Живой Сказки».", action: { label: "Настройки батареи", run: () => void openSystemSettings("battery") } });
    else if (report.battery_optimized) checks.push({ key: "battery", level: "warn", title: "Включена экономия батареи", detail: "Уведомления могут приходить с задержкой во сне. Добавьте приложение в исключения.", action: { label: "Настройки батареи", run: () => void openSystemSettings("battery") } });
    else checks.push({ key: "battery", level: "ok", title: "Экономия батареи не мешает", detail: "Приложение в исключениях оптимизации." });
    if (report.quiet_mode && report.quiet_mode !== "off" && report.quiet_mode !== "unknown") checks.push({ key: "os-quiet", level: "warn", title: "На телефоне включён «Не беспокоить»", detail: "Уведомления придут без звука или не покажутся." });
  }

  if (!input.enabled) checks.push({ key: "prefs", level: "fail", title: "Уведомления выключены в приложении", detail: "Включите их, чтобы не пропускать новые обращения.", action: { label: "Включить", run: input.toggleAlerts } });
  else if (input.dnd) checks.push({ key: "prefs", level: "warn", title: "Ваш статус «Не беспокоить»", detail: "Уведомления о новых сообщениях не приходят, пока статус не сменится." });
  else if (input.quiet) checks.push({ key: "prefs", level: "warn", title: "Сейчас тихие часы", detail: "Уведомления приходят без звука, пока не закончатся тихие часы." });
  else checks.push({ key: "prefs", level: "ok", title: "Уведомления включены в приложении", detail: "Новые сообщения и напоминания об ожидающих клиентах." });

  if (device) {
    if (device.last_ack_at) checks.push({ key: "last", level: (device.failed_24h ?? 0) > 0 ? "warn" : "ok", title: `Последнее уведомление: ${OUTCOME_LABELS[device.last_ack_outcome || ""] || "подтверждено"}`, detail: `${when(device.last_ack_at)}${(device.failed_24h ?? 0) > 0 ? ` · за сутки не доставлено: ${device.failed_24h}` : ""}${(device.pending ?? 0) > 0 ? ` · ждут подтверждения: ${device.pending}` : ""}` });
    else if (device.last_status === "failed") checks.push({ key: "last", level: "fail", title: "Последнее уведомление не доставлено", detail: `${when(device.last_attempt_at)} · ${errorLabel(device.last_error)}` });
    else checks.push({ key: "last", level: "info", title: "Уведомлений на это устройство ещё не было", detail: "Как только клиент напишет, здесь появится время и результат." });
  }

  const failed = input.outbox.filter(item => item.error).length, queued = input.outbox.length - failed;
  checks.push(failed ? { key: "outbox", level: "fail", title: `Не отправлено сообщений: ${failed}`, detail: "Повторите или уберите их ниже." }
    : queued ? { key: "outbox", level: "wait", title: `В очереди на отправку: ${queued}`, detail: "Уйдут автоматически, когда появится связь." }
    : { key: "outbox", level: "ok", title: "Все ответы отправлены", detail: "Очередь отправки пуста." });
  return checks;
}

function DeviceCard({ device, current }: { device: Device; current: boolean }) {
  const report = device.diagnostics || {};
  const Icon = device.platform === "android" ? Smartphone : Laptop;
  const facts = [
    device.socket_online ? "на связи сейчас" : `был на связи ${when(device.last_seen_at)}`,
    device.provider === "fcm" ? "Firebase" : device.provider === "webpush" ? "Web Push" : "пока запущено",
    report.permission === "denied" ? "уведомления запрещены" : report.permission === "granted" ? "уведомления разрешены" : null,
    report.battery_optimized ? "экономия батареи включена" : null,
    device.app_version ? `версия ${device.app_version}` : null,
  ].filter(Boolean);
  return (
    <article className={s.device} data-disabled={!device.enabled || undefined}>
      <Icon className={s.deviceIcon} aria-hidden="true" />
      <div className={s.deviceBody}>
        <strong>{device.name || (device.platform === "android" ? "Android" : device.platform === "windows" ? "Windows" : "Браузер")}{current && <em>это устройство</em>}{!device.enabled && <em data-tone="fail">отключено</em>}</strong>
        <span>{facts.join(" · ")}</span>
        <span>{device.last_ack_at ? `Последнее подтверждение ${when(device.last_ack_at)} (${OUTCOME_LABELS[device.last_ack_outcome || ""] || "получено"})` : device.last_status === "failed" ? `Не доставлено ${when(device.last_attempt_at)}: ${errorLabel(device.last_error)}` : "Уведомлений ещё не было"}{(device.failed_24h ?? 0) > 0 ? ` · сбоев за сутки: ${device.failed_24h}` : ""}</span>
      </div>
    </article>
  );
}

export default function LogsPage() {
  const [, refresh] = useState(0), [filter, setFilter] = useState(""), [tab, setTab] = useState("device");
  const [report, setReport] = useState<DeviceDiagnostics | null>(null);
  const operator = useAuthStore(state => state.operator);
  const socket = useSocketStore(state => state.status);
  const delivery = useDeliveryStore();
  const sessions = useInboxStore(state => state.sessions);
  const outbox = useOutbox(operator?.id);
  const manager = ["admin", "supervisor"].includes(operator?.role || "");
  const installation = getSession()?.installation_id;
  const device = delivery.devices.find(item => item.installation_id === installation);

  const reload = useCallback(() => {
    void delivery.loadDevices();
    void delivery.loadPreferences();
    void readDeviceDiagnostics().then(setReport).catch(() => setReport({ permission: "unknown" }));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => subscribeLogs(() => refresh(value => value + 1)), []);
  useEffect(() => { if (tab === "deliveries" && manager) void delivery.loadLog().catch(error => toast.error(error.message)); }, [tab]);

  const register = () => { if (operator) void startDeviceRegistration(operator.id).then(() => { toast.success("Устройство подключено к уведомлениям"); setTimeout(reload, 800); }); };
  const allow = () => void requestPushPermission().then(() => { toast.success("Уведомления разрешены"); reload(); }).catch(error => toast.error(error.message));
  const toggleAlerts = () => void delivery.savePreferences({ ...delivery.preferences, enabled: true }).then(reload).catch(() => toast.error("Не удалось сохранить"));
  const checks = deviceChecks({ socket, device, report, enabled: delivery.preferences.enabled, quiet: delivery.quiet(), dnd: operator?.status === "dnd", outbox, register, allow, toggleAlerts });
  const problems = checks.filter(item => item.level === "fail").length;
  const logs = getLogs().filter(item => !filter || `${item.tag} ${item.message} ${item.level}`.toLowerCase().includes(filter.toLowerCase()));
  const chatName = (id: string) => { const chat = sessions.find(item => item.id === id); return chat ? getSessionDisplayName(chat.visitor_name, chat.visitor_id) : "Диалог"; };

  const exportLogs = () => {
    const data = { version: __APP_VERSION__, time: new Date().toISOString(), connection: socket, checks: checks.map(({ key, level, title }) => ({ key, level, title })), device: device ? { platform: device.platform, provider: device.provider, enabled: device.enabled } : null, report, events: logs };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `zhivaya-diagnostics-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className={s.page}>
      <header className={s.header}>
        <div>
          <h1>Диагностика</h1>
          <p>{problems ? `Найдено проблем: ${problems}. Ниже — что сделать.` : "Связь и уведомления на этом устройстве в порядке."}</p>
        </div>
        <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => { reconnectSocket(); reload(); }}>Проверить снова</Button>
      </header>

      <nav className={s.tabs} aria-label="Разделы диагностики">
        <button type="button" aria-pressed={tab === "device"} onClick={() => setTab("device")}>Это устройство</button>
        <button type="button" aria-pressed={tab === "devices"} onClick={() => setTab("devices")}>Мои устройства{delivery.devices.length ? <small>{delivery.devices.length}</small> : null}</button>
        {manager && <button type="button" aria-pressed={tab === "deliveries"} onClick={() => setTab("deliveries")}>Журнал доставки</button>}
        <button type="button" aria-pressed={tab === "log"} onClick={() => setTab("log")}>События приложения</button>
      </nav>

      {tab === "device" && (
        <>
          <ul className={s.checks}>{checks.map(item => <Check key={item.key} item={item} />)}</ul>
          {outbox.length > 0 && (
            <section className={s.outbox} aria-label="Проблемы отправки">
              <h2><Send size={15} aria-hidden="true" />Очередь отправки</h2>
              {outbox.map(item => (
                <div key={item.tempId} className={s.outboxRow} data-failed={!!item.error || undefined}>
                  <div>
                    <strong>{chatName(item.sessionId)}{item.isInternal && <em>заметка</em>}</strong>
                    <span>{item.message || item.file?.name || "Файл"}</span>
                    <small>{item.error || (offlineQueue.sendingId === item.tempId ? "Отправляется…" : item.lastError ? `Повторяем: ${item.lastError}` : "Ждёт связи")}</small>
                  </div>
                  <div className={s.outboxActions}>
                    <Button size="sm" variant="ghost" onClick={() => { const chat = sessions.find(entry => entry.id === item.sessionId); if (chat) pickConversation(chat); }}>Открыть</Button>
                    {item.error && <Button size="sm" variant="secondary" onClick={() => void offlineQueue.retry(item.tempId)}>Повторить</Button>}
                    <Button size="sm" variant="dangerGhost" onClick={() => void offlineQueue.cancel(item.tempId).catch(error => toast.error(error.message))}>Убрать</Button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {tab === "devices" && (
        <div className={s.devices}>
          {delivery.devices.map(item => <DeviceCard key={item.id} device={item} current={item.installation_id === installation} />)}
          {!delivery.devices.length && <div className={s.empty}><Bell size={24} /><p>Ни одно устройство ещё не подключено к уведомлениям.</p></div>}
          <p className={s.hint}><ShieldCheck size={14} /> В уведомлениях через Firebase и Web Push нет текста переписки и имён — только служебные номера. Детали загружаются после входа.</p>
        </div>
      )}

      {tab === "deliveries" && (
        <>
          <div className={s.toolbar}>
            <p>Последние 200 уведомлений команды. «Подтверждено» — устройство показало уведомление, открыто или прочитано.</p>
            <Button variant="secondary" size="sm" onClick={() => void delivery.loadLog().catch(error => toast.error(error.message))}>Обновить</Button>
          </div>
          <div className={s.table}>
            <table>
              <thead><tr><th>Когда</th><th>Оператор · устройство</th><th>Результат</th><th>Попыток</th></tr></thead>
              <tbody>
                {delivery.log.map(item => {
                  const [state, note] = deliveryState(item);
                  return (
                    <tr key={item.id}>
                      <td>{when(item.created_at)}</td>
                      <td>{item.operator_name}<small>{item.device_name || item.platform} · {item.provider === "fcm" ? "Firebase" : item.provider === "webpush" ? "Web Push" : "приложение"}</small></td>
                      <td><span data-state={item.status}>{state}</span>{note && <small>{note}</small>}</td>
                      <td>{item.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!delivery.log.length && <div className={s.empty}>Пока нет уведомлений.</div>}
          </div>
        </>
      )}

      {tab === "log" && (
        <>
          <div className={s.toolbar}>
            <div className={s.search}><Search size={15} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Поиск событий" aria-label="Поиск событий приложения" /></div>
            <Button size="sm" variant="secondary" icon={<Download size={15} />} onClick={exportLogs}>Сохранить отчёт</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={clearLogs}>Очистить</Button>
          </div>
          <div className={s.log}>
            {logs.map((item, index) => <div className={s.event} data-level={item.level} key={index}><time>{item.time}</time><span>{item.level}</span><code>{item.tag}</code><p>{item.message}</p></div>)}
            {!logs.length && <div className={s.empty}><Activity size={24} /><p>События появятся здесь по мере работы приложения.</p></div>}
          </div>
          <p className={s.hint}>Журнал хранится только на этом устройстве и никуда не отправляется. Отчёт можно сохранить и передать разработчику.</p>
        </>
      )}
    </section>
  );
}

