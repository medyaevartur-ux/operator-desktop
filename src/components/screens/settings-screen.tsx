import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useThemeStore } from "@/store/theme.store";
import { uploadAvatar, updateOperator } from "@/features/operators/operators.api";
import { API_BASE } from "@/lib/api";
import { ArrowLeft, Camera, Save, LogOut, Zap, Plus, Pencil, Trash2, Power, RefreshCw } from "lucide-react";
import { Toggle, toast, useConfirm } from "@/components/ui";
import { checkForUpdatesManually } from "@/components/updater";
import {
  getAutoResponses,
  createAutoResponse,
  updateAutoResponse,
  deleteAutoResponse,
  type AutoResponseRule,
} from "@/features/inbox/inbox.api";
import s from "./SettingsScreen.module.css";
const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  supervisor: "Супервайзер",
  operator: "Оператор",
};

import { Volume2 } from "lucide-react";

function SoundRow({
  label,
  checked,
  onChange,
  onPreview,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onPreview: () => void;
}) {
  return (
    <div className={s.soundRow}>
      <Toggle label={label} checked={checked} onChange={onChange} />
      <button type="button" className={s.previewBtn} onClick={onPreview} title="Прослушать">
        <Volume2 style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}
export function SettingsScreen() {
  const operator = useAuthStore((st) => st.operator);
  const logout = useAuthStore((st) => st.logout);
  const checkAuth = useAuthStore((st) => st.checkAuth);
  const setScreen = useNavigationStore((st) => st.setScreen);

  const soundEnabled = useNotificationStore((st) => st.soundEnabled);
  const setSoundEnabled = useNotificationStore((st) => st.setSoundEnabled);
  const desktopEnabled = useNotificationStore((st) => st.desktopEnabled);
  const setDesktopEnabled = useNotificationStore((st) => st.setDesktopEnabled);
  const soundVolume = useNotificationStore((st) => st.soundVolume);
  const setSoundVolume = useNotificationStore((st) => st.setSoundVolume);
  const soundNewMessage = useNotificationStore((st) => st.soundNewMessage);
  const setSoundNewMessage = useNotificationStore((st) => st.setSoundNewMessage);
  const soundNewChat = useNotificationStore((st) => st.soundNewChat);
  const setSoundNewChat = useNotificationStore((st) => st.setSoundNewChat);
  const soundMention = useNotificationStore((st) => st.soundMention);
  const setSoundMention = useNotificationStore((st) => st.setSoundMention);
  const soundChatClosed = useNotificationStore((st) => st.soundChatClosed);
  const setSoundChatClosed = useNotificationStore((st) => st.setSoundChatClosed);
  const previewSound = useNotificationStore((st) => st.previewSound);
  const dndScheduleEnabled = useNotificationStore((st) => st.dndScheduleEnabled);
  const setDndScheduleEnabled = useNotificationStore((st) => st.setDndScheduleEnabled);
  const dndFrom = useNotificationStore((st) => st.dndFrom);
  const setDndFrom = useNotificationStore((st) => st.setDndFrom);
  const dndTo = useNotificationStore((st) => st.dndTo);
  const setDndTo = useNotificationStore((st) => st.setDndTo);  
  const closeToTray = useNotificationStore((st) => st.closeToTray);
  const setCloseToTray = useNotificationStore((st) => st.setCloseToTray);
  const showMessagePreview = useNotificationStore((st) => st.showMessagePreview);
  const setShowMessagePreview = useNotificationStore((st) => st.setShowMessagePreview);
  const slaEnabled = useNotificationStore((st) => st.slaEnabled);
  const setSlaEnabled = useNotificationStore((st) => st.setSlaEnabled);
  const slaWarnMinutes = useNotificationStore((st) => st.slaWarnMinutes);
  const setSlaWarnMinutes = useNotificationStore((st) => st.setSlaWarnMinutes);
  const slaOverdueMinutes = useNotificationStore((st) => st.slaOverdueMinutes);
  const setSlaOverdueMinutes = useNotificationStore((st) => st.setSlaOverdueMinutes);
  const customSound = useNotificationStore((st) => st.customSound);
  const customSoundName = useNotificationStore((st) => st.customSoundName);
  const setCustomSound = useNotificationStore((st) => st.setCustomSound);
  const { confirm } = useConfirm();
  
  const density = useThemeStore((st) => st.density);
  const setDensity = useThemeStore((st) => st.setDensity);
  const autoTimeTheme = useThemeStore((st) => st.autoTimeTheme);
  const setAutoTimeTheme = useThemeStore((st) => st.setAutoTimeTheme);

  const isAdmin = operator?.role === "admin" || operator?.role === "supervisor";
  // ═══ Авто-ответы ═══
  const [autoRules, setAutoRules] = useState<AutoResponseRule[]>([]);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoResponseRule | null>(null);
  const [newRuleMessage, setNewRuleMessage] = useState("");
  const [newRuleDelay, setNewRuleDelay] = useState(180);
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setIsAutoLoading(true);
    getAutoResponses()
      .then(setAutoRules)
      .catch(() => {})
      .finally(() => setIsAutoLoading(false));
  }, [isAdmin]);

  const handleCreateRule = async () => {
    if (!newRuleMessage.trim()) return;
    try {
      const rule = await createAutoResponse({
        trigger_type: "queue_timeout",
        delay_seconds: newRuleDelay,
        message: newRuleMessage.trim(),
      });
      setAutoRules((prev) => [...prev, rule]);
      setNewRuleMessage("");
      setNewRuleDelay(180);
      setShowNewForm(false);
      toast.success("Правило создано");
    } catch {
      toast.error("Ошибка создания");
    }
  };

  const handleToggleRule = async (rule: AutoResponseRule) => {
    try {
      const updated = await updateAutoResponse(rule.id, { is_active: !rule.is_active });
      setAutoRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch {
      toast.error("Ошибка обновления");
    }
  };

  const handleSaveRule = async () => {
    if (!editingRule) return;
    try {
      const updated = await updateAutoResponse(editingRule.id, {
        message: editingRule.message,
        delay_seconds: editingRule.delay_seconds,
      });
      setAutoRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingRule(null);
      toast.success("Сохранено");
    } catch {
      toast.error("Ошибка сохранения");
    }
  };

  const handleDeleteRule = async (id: string) => {
    const ok = await confirm({
      title: "Удалить правило?",
      message: "Автоответ будет удалён без возможности восстановления.",
      confirmText: "Удалить",
      cancelText: "Отмена",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAutoResponse(id);
      setAutoRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Удалено");
    } catch {
      toast.error("Ошибка удаления");
    }
  };
  const [name, setName] = useState(operator?.name ?? "");
  const [email, setEmail] = useState(operator?.email ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    operator?.avatar_url ? `${API_BASE}${operator.avatar_url}` : null,
  );

  /* ── Avatar upload with cleanup (9.4) ── */
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !operator) return;

    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);

    try {
      const res = await uploadAvatar(operator.id, file);
      URL.revokeObjectURL(objectUrl);
      setAvatarPreview(`${API_BASE}${res.avatar_url}`);
      void checkAuth();
    } catch {
      URL.revokeObjectURL(objectUrl);
      toast.error("Ошибка загрузки аватара");
    }
  };

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  /* ── Save profile (9.7) ── */
  const handleSave = async () => {
    if (!operator) return;
    setSaving(true);
    setSaved(false);

    try {
      const data: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
      };
      if (password) data.password = password;
      await updateOperator(operator.id, data);
      void checkAuth();
      setPassword("");
      setSaved(true);
      toast.success("Сохранено");
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка сохранения";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /* ── Logout with confirm (9.3) ── */
  const handleLogout = async () => {
    const ok = await confirm({
      title: "Выйти из аккаунта?",
      message: "Вы будете разлогинены. Все открытые чаты останутся назначенными за вами.",
      confirmText: "Выйти",
      cancelText: "Остаться",
      danger: true,
    });
    if (ok) logout();
  };

  const roleLabel = ROLE_LABELS[operator?.role ?? "operator"] ?? "Оператор";

  return (
    <div className={s.screen}>
      {/* ── Header ── */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => setScreen("inbox")}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <h1 className={s.headerTitle}>Настройки</h1>
      </div>

      {/* ── Body ── */}
      <div className={`${s.body} scrollbar-thin`}>
        {/* ═══ Разделы (перенесены из рейла для чистоты) ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>Разделы</div>
          <div className={s.sectionCard}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)" }}>
              {[
                { label: "Очередь", emoji: "📋", screen: "queue" as const, desc: "Чаты, ждущие оператора" },
                { label: "Виджет на сайте", emoji: "🎨", screen: "widget_settings" as const, desc: "Внешний вид и поведение" },
                { label: "Логи", emoji: "📜", screen: "logs" as const, desc: "Диагностика приложения" },
              ].map((it) => (
                <button
                  key={it.screen}
                  type="button"
                  onClick={() => setScreen(it.screen)}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--space-3)",
                    padding: "var(--space-4)", textAlign: "left",
                    background: "var(--surface-2)", border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--md-sys-shape-corner-large)", cursor: "pointer",
                    color: "var(--text-primary)", boxShadow: "var(--md-sys-elevation-level1)",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{it.emoji}</span>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{it.label}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ Профиль ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>Профиль</div>
          <div className={s.sectionCard}>
            {/* Avatar */}
            <div className={s.avatarRow}>
              <label className={s.avatarLabel}>
                <div
                  className={s.avatarImg}
                  style={avatarPreview ? { backgroundImage: `url(${avatarPreview})` } : undefined}
                >
                  {!avatarPreview && (operator?.name?.charAt(0).toUpperCase() ?? "?")}
                </div>
                <div className={s.avatarBadge}>
                  <Camera style={{ width: 13, height: 13 }} />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: "none" }}
                />
              </label>
              <div className={s.avatarInfo}>
                <div className={s.avatarName}>{operator?.name}</div>
                <div className={s.avatarRole}>{roleLabel}</div>
                <div className={s.avatarHint}>Нажмите на фото для замены</div>
              </div>
            </div>

            {/* Fields */}
            <div className={s.field}>
              <div className={s.fieldLabel}>Имя</div>
              <input
                className={s.fieldInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={s.field}>
              <div className={s.fieldLabel}>Email</div>
              <input
                className={s.fieldInput}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className={s.field}>
              <div className={s.fieldLabel}>Новый пароль</div>
              <input
                className={s.fieldInput}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Оставьте пустым если не меняете"
              />
            </div>

            <button
              className={`${s.saveBtn} ${saved ? s.saveBtnSaved : ""}`}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              <Save style={{ width: 14, height: 14 }} />
              {saved ? "Сохранено ✓" : saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>

        {/* ═══ Уведомления ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>Уведомления</div>
          <div className={s.sectionCard}>
            <Toggle
              label="Звук уведомлений"
              checked={soundEnabled}
              onChange={setSoundEnabled}
            />
            <Toggle
              label="Desktop уведомления"
              checked={desktopEnabled}
              onChange={setDesktopEnabled}
            />

            {/* ═══ SLA: чаты без ответа ═══ */}
            <div className={s.soundSection}>
              <Toggle
                label="⏱ Контроль ответа (SLA)"
                checked={slaEnabled}
                onChange={setSlaEnabled}
              />
              {slaEnabled && (
                <>
                  <div className={s.volumeRow}>
                    <span className={s.volumeLabel}>Предупреждение через</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={slaWarnMinutes}
                      onChange={(e) => setSlaWarnMinutes(Math.max(1, Number(e.target.value) || 1))}
                      className={s.volumeValue}
                      style={{ width: 56, textAlign: "center", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--text-primary)", padding: "4px 6px" }}
                    />
                    <span className={s.volumeLabel}>мин</span>
                  </div>
                  <div className={s.volumeRow}>
                    <span className={s.volumeLabel}>Эскалация (звук + Windows-уведомление) через</span>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={slaOverdueMinutes}
                      onChange={(e) => setSlaOverdueMinutes(Math.max(1, Number(e.target.value) || 1))}
                      className={s.volumeValue}
                      style={{ width: 56, textAlign: "center", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--text-primary)", padding: "4px 6px" }}
                    />
                    <span className={s.volumeLabel}>мин</span>
                  </div>
                </>
              )}
            </div>

            {soundEnabled && (
              <div className={s.soundSection}>
                <div className={s.soundSectionTitle}>Типы звуков</div>
                <SoundRow
                  label="💬 Новое сообщение"
                  checked={soundNewMessage}
                  onChange={setSoundNewMessage}
                  onPreview={() => previewSound("new_message")}
                />
                <SoundRow
                  label="🆕 Новый чат"
                  checked={soundNewChat}
                  onChange={setSoundNewChat}
                  onPreview={() => previewSound("new_chat")}
                />
                <SoundRow
                  label="📣 Упоминание"
                  checked={soundMention}
                  onChange={setSoundMention}
                  onPreview={() => previewSound("mention")}
                />
                <SoundRow
                  label="✅ Чат закрыт"
                  checked={soundChatClosed}
                  onChange={setSoundChatClosed}
                  onPreview={() => previewSound("chat_closed")}
                />

                <div className={s.volumeRow}>
                  <span className={s.volumeLabel}>Громкость</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={soundVolume}
                    onChange={(e) => setSoundVolume(Number(e.target.value))}
                    className={s.volumeSlider}
                  />
                  <span className={s.volumeValue}>{Math.round(soundVolume * 100)}%</span>
                </div>

                {/* Кастомный звук (Задача 37) */}
                <div className={s.customSoundRow} style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      🎵 Собственный звук уведомлений
                    </span>
                    {customSound ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--sys-bg)", border: "1px solid var(--border)", padding: "10px 14px", borderRadius: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {customSoundName || "custom.mp3"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                const audio = new Audio(customSound);
                                audio.volume = soundVolume;
                                audio.play();
                              } catch (e) {
                                console.error(e);
                              }
                            }}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}
                            title="Прослушать"
                          >
                            ▶️
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCustomSound(null, null)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--status-dnd)", fontSize: 12, fontWeight: 600 }}
                        >
                          Удалить
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "var(--accent)", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s" }}>
                          📥 Загрузить mp3
                          <input
                            type="file"
                            accept="audio/mp3,audio/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              if (file.size > 2 * 1024 * 1024) {
                                alert("Файл слишком большой. Максимум 2MB.");
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const base64 = event.target?.result as string;
                                setCustomSound(base64, file.name);
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-disabled)", marginTop: 6 }}>
                          MP3 или WAV до 2MB. Заменит все стандартные сигналы.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ Поведение приложения ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>🖥️ Приложение</div>
          <div className={s.sectionCard}>
            <Toggle
              label="Сворачивать в трей при закрытии"
              checked={closeToTray}
              onChange={setCloseToTray}
            />
            <div className={s.dndHint}>
              Приложение останется в трее и будет получать уведомления
            </div>
            <Toggle
              label="Показывать текст сообщения в уведомлениях"
              checked={showMessagePreview}
              onChange={setShowMessagePreview}
            />
            <div className={s.dndHint}>
              Отключите для конфиденциальности — будет показано только имя отправителя
            </div>
            <button
              type="button"
              className={s.updateBtn}
              onClick={async () => {
                try {
                  toast.info("Проверяем обновления…");
                  const res = await checkForUpdatesManually();
                  toast.success(res);
                } catch (e: any) {
                  toast.error("Ошибка проверки обновлений", e?.message || String(e));
                }
              }}
            >
              <RefreshCw style={{ width: 16, height: 16 }} />
              Проверить обновления
            </button>
          </div>
        </div>

        {/* ═══ Внешний вид и Оформление ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>🎨 Внешний вид</div>
          <div className={s.sectionCard}>
            <div className={s.field}>
              <div className={s.fieldLabel}>Плотность интерфейса</div>
              <div className={s.densityToggleGroup}>
                <button
                  type="button"
                  className={`${s.densityBtn} ${density === "comfortable" ? s.densityBtnActive : ""}`}
                  onClick={() => setDensity("comfortable")}
                >
                  👐 Просторный
                </button>
                <button
                  type="button"
                  className={`${s.densityBtn} ${density === "compact" ? s.densityBtnActive : ""}`}
                  onClick={() => setDensity("compact")}
                >
                  ⚡ Компактный
                </button>
              </div>
              <div className={s.dndHint}>
                Компактный режим сжимает отступы для отображения большего объема данных
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <Toggle
                label="Авто-темная тема по времени суток"
                checked={autoTimeTheme}
                onChange={setAutoTimeTheme}
              />
              <div className={s.dndHint}>
                Автоматически включает тёмную тему с 19:00 до 07:00
              </div>
            </div>
          </div>
        </div>

        {/* ═══ DND Расписание ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>🌙 Не беспокоить</div>
          <div className={s.sectionCard}>
            <Toggle
              label="Тихий режим по расписанию"
              checked={dndScheduleEnabled}
              onChange={setDndScheduleEnabled}
            />
            {dndScheduleEnabled && (
              <div className={s.dndTimeRow}>
                <label className={s.dndLabel}>
                  С
                  <input
                    type="time"
                    className={s.dndTimeInput}
                    value={dndFrom}
                    onChange={(e) => setDndFrom(e.target.value)}
                  />
                </label>
                <label className={s.dndLabel}>
                  До
                  <input
                    type="time"
                    className={s.dndTimeInput}
                    value={dndTo}
                    onChange={(e) => setDndTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            <div className={s.dndHint}>
              В указанное время звуки и уведомления будут отключены
            </div>
          </div>
        </div>

        {/* ═══ Авто-ответы ═══ */}
        {isAdmin && (
          <div className={s.section}>
            <div className={s.sectionTitle}>
              <Zap style={{ width: 14, height: 14, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Авто-ответы
            </div>
            <div className={s.sectionCard}>
              {isAutoLoading && <div className={s.autoEmpty}>Загрузка...</div>}

              {!isAutoLoading && autoRules.length === 0 && !showNewForm && (
                <div className={s.autoEmpty}>Нет настроенных правил</div>
              )}

              {autoRules.map((rule) => (
                <div key={rule.id} className={s.autoRule}>
                  {editingRule?.id === rule.id ? (
                    <div className={s.autoEditForm}>
                      <textarea
                        className={s.autoTextarea}
                        value={editingRule.message}
                        onChange={(e) => setEditingRule({ ...editingRule, message: e.target.value })}
                      />
                      <div className={s.autoEditRow}>
                        <label className={s.autoLabel}>
                          Задержка (сек):
                          <input
                            type="number"
                            className={s.autoDelayInput}
                            value={editingRule.delay_seconds}
                            onChange={(e) => setEditingRule({ ...editingRule, delay_seconds: Number(e.target.value) })}
                            min={30}
                            max={3600}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className={s.autoBtn} onClick={() => setEditingRule(null)}>Отмена</button>
                          <button className={s.autoBtnAccent} onClick={() => void handleSaveRule()}>
                            <Save style={{ width: 12, height: 12 }} /> Сохранить
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={s.autoRuleHeader}>
                        <div className={s.autoRuleType}>
                          <Zap style={{ width: 13, height: 13 }} />
                          {rule.trigger_type === "queue_timeout" ? "Таймаут очереди" : rule.trigger_type}
                          <span className={s.autoDelay}>{rule.delay_seconds}с</span>
                        </div>
                        <div className={s.autoRuleActions}>
                          <button
                            className={`${s.autoToggle} ${rule.is_active ? s.autoToggleOn : s.autoToggleOff}`}
                            onClick={() => void handleToggleRule(rule)}
                            title={rule.is_active ? "Выключить" : "Включить"}
                          >
                            <Power style={{ width: 13, height: 13 }} />
                          </button>
                          <button className={s.autoIconBtn} onClick={() => setEditingRule({ ...rule })}>
                            <Pencil style={{ width: 13, height: 13 }} />
                          </button>
                          <button className={`${s.autoIconBtn} ${s.autoIconBtnDanger}`} onClick={() => void handleDeleteRule(rule.id)}>
                            <Trash2 style={{ width: 13, height: 13 }} />
                          </button>
                        </div>
                      </div>
                      <div className={`${s.autoRuleMessage} ${!rule.is_active ? s.autoRuleDisabled : ""}`}>
                        {rule.message}
                      </div>
                    </>
                  )}
                </div>
              ))}

              {showNewForm ? (
                <div className={s.autoNewForm}>
                  <textarea
                    className={s.autoTextarea}
                    value={newRuleMessage}
                    onChange={(e) => setNewRuleMessage(e.target.value)}
                    placeholder="Текст автоответа..."
                  />
                  <div className={s.autoEditRow}>
                    <label className={s.autoLabel}>
                      Задержка (сек):
                      <input
                        type="number"
                        className={s.autoDelayInput}
                        value={newRuleDelay}
                        onChange={(e) => setNewRuleDelay(Number(e.target.value))}
                        min={30}
                        max={3600}
                      />
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className={s.autoBtn} onClick={() => { setShowNewForm(false); setNewRuleMessage(""); }}>Отмена</button>
                      <button className={s.autoBtnAccent} onClick={() => void handleCreateRule()}>
                        <Plus style={{ width: 12, height: 12 }} /> Создать
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button className={s.autoAddBtn} onClick={() => setShowNewForm(true)}>
                  <Plus style={{ width: 14, height: 14 }} />
                  Добавить правило
                </button>
              )}
            </div>
          </div>
        )}
        {/* ═══ Аккаунт ═══ */}
        <div className={s.section}>
          <div className={s.sectionTitle}>Аккаунт</div>
          <div className={s.sectionCard}>
            <button className={s.logoutBtn} onClick={() => void handleLogout()}>
              <LogOut style={{ width: 14, height: 14 }} />
              Выйти из аккаунта
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}