import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";
import { useNavigationStore } from "@/store/navigation.store";
import { uploadAvatar, updateOperator } from "@/features/operators/operators.api";
import { API_BASE } from "@/lib/api";
import { ArrowLeft, Camera, Save, LogOut, Zap, Plus, Pencil, Trash2, Power, GripVertical, FileText, X } from "lucide-react";
import { Toggle, toast, useConfirm } from "@/components/ui";
import {
  getAutoResponses,
  createAutoResponse,
  updateAutoResponse,
  deleteAutoResponse,
  type AutoResponseRule,
} from "@/features/inbox/inbox.api";
import s from "./SettingsScreen.module.css";
import {
  getPrechatFormConfig,
  savePrechatFormConfig,
  type PrechatFormConfig,
  type PrechatField,
} from "@/features/settings/settings.api";
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
  const { confirm } = useConfirm();
  const isAdmin = operator?.role === "admin" || operator?.role === "supervisor";
  // ═══ Авто-ответы ═══
  const [autoRules, setAutoRules] = useState<AutoResponseRule[]>([]);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoResponseRule | null>(null);
  const [newRuleMessage, setNewRuleMessage] = useState("");
  const [newRuleDelay, setNewRuleDelay] = useState(180);
  const [showNewForm, setShowNewForm] = useState(false);
  // ═══ Pre-chat Form ═══
  const [prechatConfig, setPrechatConfig] = useState<PrechatFormConfig>({
    enabled: false,
    fields: [
      { name: "name", label: "Имя", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Телефон", type: "tel", required: false },
    ],
  });
  const [prechatLoading, setPrechatLoading] = useState(false);
  const [prechatSaving, setPrechatSaving] = useState(false);
  const [prechatSaved, setPrechatSaved] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setPrechatLoading(true);
    getPrechatFormConfig()
      .then(setPrechatConfig)
      .catch(() => {})
      .finally(() => setPrechatLoading(false));
  }, [isAdmin]);

  const handleSavePrechat = async () => {
    setPrechatSaving(true);
    setPrechatSaved(false);
    try {
      const saved = await savePrechatFormConfig(prechatConfig);
      setPrechatConfig(saved);
      setPrechatSaved(true);
      toast.success("Форма сохранена");
      setTimeout(() => setPrechatSaved(false), 2000);
    } catch {
      toast.error("Ошибка сохранения формы");
    } finally {
      setPrechatSaving(false);
    }
  };

  const addPrechatField = () => {
    const id = `field_${Date.now()}`;
    setPrechatConfig((prev) => ({
      ...prev,
      fields: [...prev.fields, { name: id, label: "Новое поле", type: "text", required: false }],
    }));
  };

  const removePrechatField = (index: number) => {
    setPrechatConfig((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  };

  const updatePrechatField = (index: number, patch: Partial<PrechatField>) => {
    setPrechatConfig((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  };

  const movePrechatField = (from: number, to: number) => {
    setPrechatConfig((prev) => {
      const fields = [...prev.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved);
      return { ...prev, fields };
    });
  };
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
              </div>
            )}
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

        {/* ═══ Форма перед чатом ═══ */}
        {isAdmin && (
          <div className={s.section}>
            <div className={s.sectionTitle}>
              <FileText style={{ width: 14, height: 14, display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Форма перед чатом
            </div>
            <div className={s.sectionCard}>
              <Toggle
                label="Показывать форму перед началом чата"
                checked={prechatConfig.enabled}
                onChange={(v) => setPrechatConfig((prev) => ({ ...prev, enabled: v }))}
              />

              {prechatConfig.enabled && (
                <div className={s.prechatFields}>
                  {prechatConfig.fields.map((field, i) => (
                    <div key={field.name} className={s.prechatFieldRow}>
                      <div className={s.prechatDrag}>
                        {i > 0 && (
                          <button
                            type="button"
                            className={s.prechatMoveBtn}
                            onClick={() => movePrechatField(i, i - 1)}
                            title="Вверх"
                          >
                            ↑
                          </button>
                        )}
                        {i < prechatConfig.fields.length - 1 && (
                          <button
                            type="button"
                            className={s.prechatMoveBtn}
                            onClick={() => movePrechatField(i, i + 1)}
                            title="Вниз"
                          >
                            ↓
                          </button>
                        )}
                        <GripVertical style={{ width: 14, height: 14, color: "var(--text-disabled)" }} />
                      </div>

                      <div className={s.prechatFieldBody}>
                        <input
                          className={s.prechatInput}
                          value={field.label}
                          onChange={(e) => updatePrechatField(i, { label: e.target.value })}
                          placeholder="Название поля"
                        />
                        <select
                          className={s.prechatSelect}
                          value={field.type}
                          onChange={(e) => updatePrechatField(i, { type: e.target.value as PrechatField["type"] })}
                        >
                          <option value="text">Текст</option>
                          <option value="email">Email</option>
                          <option value="tel">Телефон</option>
                          <option value="select">Выбор</option>
                        </select>
                        <Toggle
                          label="Обязат."
                          checked={field.required}
                          onChange={(v) => updatePrechatField(i, { required: v })}
                        />
                      </div>

                      <button
                        type="button"
                        className={`${s.autoIconBtn} ${s.autoIconBtnDanger}`}
                        onClick={() => removePrechatField(i)}
                        title="Удалить поле"
                      >
                        <X style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  ))}

                  <button className={s.autoAddBtn} onClick={addPrechatField}>
                    <Plus style={{ width: 14, height: 14 }} />
                    Добавить поле
                  </button>

                  {/* Preview */}
                  <div className={s.prechatPreview}>
                    <div className={s.prechatPreviewTitle}>Предпросмотр</div>
                    <div className={s.prechatPreviewCard}>
                      {prechatConfig.fields.map((f) => (
                        <div key={f.name} className={s.prechatPreviewField}>
                          <label className={s.prechatPreviewLabel}>
                            {f.label}
                            {f.required && <span style={{ color: "var(--error)" }}> *</span>}
                          </label>
                          <input
                            className={s.prechatPreviewInput}
                            type={f.type === "select" ? "text" : f.type}
                            placeholder={f.label}
                            disabled
                          />
                        </div>
                      ))}
                      <button className={s.prechatPreviewBtn} disabled>
                        Начать чат
                      </button>
                    </div>
                  </div>

                  <button
                    className={`${s.saveBtn} ${prechatSaved ? s.saveBtnSaved : ""}`}
                    onClick={() => void handleSavePrechat()}
                    disabled={prechatSaving}
                    style={{ marginTop: 12 }}
                  >
                    <Save style={{ width: 14, height: 14 }} />
                    {prechatSaved ? "Сохранено ✓" : prechatSaving ? "Сохранение..." : "Сохранить форму"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        
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