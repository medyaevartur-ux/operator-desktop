import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft, Save, MessageCircle, HelpCircle, Sparkles,
  Copy, Check, AlertTriangle, X, Plus,
  Palette, FileText, Clock, Globe, Code, Trash2,
} from "lucide-react";
import { useNavigationStore } from "@/store/navigation.store";
import {
  getWidgetConfig, saveWidgetConfig, getWidgetEmbedCode,
  uploadWidgetAvatar,
  getPrechatFormConfig, savePrechatFormConfig,
  getBusinessHours, saveBusinessHours,
  getDomainSettings, saveDomainSettings,
  type WidgetConfig, type PrechatFormConfig, type PrechatField,
  type BusinessHours, type DaySchedule, type DomainSettings,
} from "@/features/settings/settings.api";
import { API_BASE } from "@/lib/api";
import { Toggle, toast } from "@/components/ui";
import s from "./WidgetSettingsScreen.module.css";

type Tab = "appearance" | "prechat" | "hours" | "domains" | "embed";

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "Внешний вид", icon: Palette },
  { id: "prechat", label: "Пречат-форма", icon: FileText },
  { id: "hours", label: "Рабочие часы", icon: Clock },
  { id: "domains", label: "Домены", icon: Globe },
  { id: "embed", label: "Код встройки", icon: Code },
];

const COLOR_PRESETS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9",
  "#14b8a6", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#ec4899", "#a855f7", "#1e293b",
];

const DAY_LABELS: Record<string, string> = {
  mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс",
};

export function WidgetSettingsScreen() {
  const setScreen = useNavigationStore((st) => st.setScreen);
  const [tab, setTab] = useState<Tab>("appearance");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<WidgetConfig>({
    position: "bottom-right", color: "#8b5cf6",
    greeting: "Привет! 👋\nЧем могу помочь?", header_title: "Онлайн-чат",
    avatar_url: null, show_operator_name: true, show_operator_avatar: true,
    button_icon: "chat", button_text: "", button_size: "medium", button_radius: "round",
    auto_open_delay: 0, hide_on_mobile: false, custom_css: "",
  });

  const [prechat, setPrechat] = useState<PrechatFormConfig>({
    enabled: true,
    fields: [{ name: "name", label: "Как вас зовут?", type: "text", required: true, placeholder: "Ваше имя" }],
  });

  const [hours, setHours] = useState<BusinessHours>({
    enabled: false, timezone: "Europe/Moscow",
    offline_message: "Мы сейчас офлайн. Оставьте сообщение!",
    schedule: {
      mon: { enabled: true, from: "09:00", to: "18:00" },
      tue: { enabled: true, from: "09:00", to: "18:00" },
      wed: { enabled: true, from: "09:00", to: "18:00" },
      thu: { enabled: true, from: "09:00", to: "18:00" },
      fri: { enabled: true, from: "09:00", to: "18:00" },
      sat: { enabled: false, from: "10:00", to: "16:00" },
      sun: { enabled: false, from: "10:00", to: "16:00" },
    },
  });

  const [domains, setDomains] = useState<DomainSettings>({
    enabled: false, domains: [], rate_limit: 30,
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getWidgetConfig().then(setConfig).catch(() => {}),
      getPrechatFormConfig().then(setPrechat).catch(() => {}),
      getBusinessHours().then(setHours).catch(() => {}),
      getDomainSettings().then(setDomains).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      if (tab === "appearance") {
        const r = await saveWidgetConfig(config);
        setConfig(r);
      } else if (tab === "prechat") {
        await savePrechatFormConfig(prechat);
      } else if (tab === "hours") {
        await saveBusinessHours(hours);
      } else if (tab === "domains") {
        await saveDomainSettings(domains);
      }
      setSaved(true);
      toast.success("Сохранено");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadWidgetAvatar(file);
      setConfig((p) => ({ ...p, avatar_url: url }));
      toast.success("Аватар загружен");
    } catch {
      toast.error("Ошибка загрузки");
    }
  };

  const handleCopyEmbed = async () => {
    await navigator.clipboard.writeText(getWidgetEmbedCode(API_BASE));
    setCopied(true);
    toast.success("Код скопирован");
    setTimeout(() => setCopied(false), 2000);
  };

  const upd = (patch: Partial<WidgetConfig>) => setConfig((p) => ({ ...p, ...patch }));
  const posRight = config.position === "bottom-right";

  // ── Prechat helpers ──
  const addField = () => {
    setPrechat((p) => ({
      ...p,
      fields: [...p.fields, { name: `field_${Date.now()}`, label: "Новое поле", type: "text", required: false, placeholder: "" }],
    }));
  };

  const updateField = (idx: number, patch: Partial<PrechatField>) => {
    setPrechat((p) => ({
      ...p,
      fields: p.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (idx: number) => {
    setPrechat((p) => ({ ...p, fields: p.fields.filter((_, i) => i !== idx) }));
  };

  // ── Hours helpers ──
  const updateDay = (day: string, patch: Partial<DaySchedule>) => {
    setHours((p) => ({
      ...p,
      schedule: { ...p.schedule, [day]: { ...p.schedule[day as keyof typeof p.schedule], ...patch } },
    }));
  };

  // ── Domain helpers ──
  const addDomain = () => setDomains((p) => ({ ...p, domains: [...p.domains, ""] }));
  const updateDomain = (idx: number, val: string) => {
    setDomains((p) => ({ ...p, domains: p.domains.map((d, i) => (i === idx ? val : d)) }));
  };
  const removeDomain = (idx: number) => {
    setDomains((p) => ({ ...p, domains: p.domains.filter((_, i) => i !== idx) }));
  };

  if (loading) {
    return (
      <div className={s.screen}>
        <div className={s.header}>
          <button className={s.backBtn} onClick={() => setScreen("settings")}>
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </button>
          <h1 className={s.headerTitle}>Настройки виджета</h1>
        </div>
        <div style={{ padding: 32, color: "var(--text-muted)" }}>Загрузка…</div>
      </div>
    );
  }

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => setScreen("settings")}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <h1 className={s.headerTitle}>Настройки виджета</h1>
      </div>

      {/* Tabs */}
      <div className={s.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${s.tab} ${tab === t.id ? s.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            <t.icon style={{ width: 14, height: 14 }} />
            {t.label}
          </button>
        ))}
      </div>

      <div className={s.main}>
        {/* ═══ Left: Form ═══ */}
        <div className={`${s.form} scrollbar-thin`}>

          {/* ══ TAB: Appearance ══ */}
          {tab === "appearance" && (
            <>
              {/* Avatar */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Аватар виджета</div>
                <div className={s.sectionCard}>
                  <div className={s.avatarSection}>
                    <div className={s.avatarPreview}>
                      {config.avatar_url ? (
                        <img src={`${API_BASE}${config.avatar_url}`} alt="avatar" />
                      ) : (
                        <MessageCircle style={{ width: 24, height: 24, color: "var(--text-muted)" }} />
                      )}
                    </div>
                    <div className={s.avatarActions}>
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
                      <button className={s.avatarUploadBtn} onClick={() => fileRef.current?.click()}>
                        Загрузить
                      </button>
                      {config.avatar_url && (
                        <button className={s.avatarRemoveBtn} onClick={() => upd({ avatar_url: null })}>
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Header title */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Заголовок</div>
                <div className={s.sectionCard}>
                  <div className={s.field}>
                    <div className={s.fieldLabel}>Текст в шапке виджета</div>
                    <input
                      className={s.fieldInput}
                      value={config.header_title}
                      onChange={(e) => upd({ header_title: e.target.value })}
                      placeholder="Онлайн-чат"
                    />
                  </div>
                </div>
              </div>

              {/* Color */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Цвет</div>
                <div className={s.sectionCard}>
                  <div className={s.colorRow}>
                    <div className={s.colorSwatch}>
                      <input type="color" className={s.colorInput} value={config.color} onChange={(e) => upd({ color: e.target.value })} />
                    </div>
                    <input className={s.colorHex} value={config.color} onChange={(e) => upd({ color: e.target.value })} maxLength={7} />
                  </div>
                  <div className={s.colorPresets}>
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c} type="button"
                        className={`${s.colorPreset} ${config.color === c ? s.colorPresetActive : ""}`}
                        style={{ background: c }}
                        onClick={() => upd({ color: c })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Position */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Позиция</div>
                <div className={s.sectionCard}>
                  <div className={s.positionRow}>
                    <button type="button" className={`${s.positionBtn} ${config.position === "bottom-left" ? s.positionBtnActive : ""}`} onClick={() => upd({ position: "bottom-left" })}>↙ Слева</button>
                    <button type="button" className={`${s.positionBtn} ${config.position === "bottom-right" ? s.positionBtnActive : ""}`} onClick={() => upd({ position: "bottom-right" })}>↘ Справа</button>
                  </div>
                </div>
              </div>

              {/* Button icon + size */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Кнопка</div>
                <div className={s.sectionCard}>
                  <div className={s.iconRow}>
                    <button type="button" className={`${s.iconBtn} ${config.button_icon === "chat" ? s.iconBtnActive : ""}`} onClick={() => upd({ button_icon: "chat" })}><MessageCircle style={{ width: 22, height: 22 }} /></button>
                    <button type="button" className={`${s.iconBtn} ${config.button_icon === "help" ? s.iconBtnActive : ""}`} onClick={() => upd({ button_icon: "help" })}><HelpCircle style={{ width: 22, height: 22 }} /></button>
                    <button type="button" className={`${s.iconBtn} ${config.button_icon === "custom" ? s.iconBtnActive : ""}`} onClick={() => upd({ button_icon: "custom" })}><Sparkles style={{ width: 22, height: 22 }} /></button>
                  </div>

                  <div className={s.field} style={{ marginTop: 12 }}>
                    <div className={s.fieldLabel}>Текст на кнопке</div>
                    <input className={s.fieldInput} value={config.button_text} onChange={(e) => upd({ button_text: e.target.value })} placeholder="Помощь" />
                  </div>

                  <div className={s.fieldLabel} style={{ marginTop: 12 }}>Размер</div>
                  <div className={s.sizeRow}>
                    {(["small", "medium", "large"] as const).map((sz) => (
                      <button key={sz} type="button" className={`${s.sizeBtn} ${config.button_size === sz ? s.sizeBtnActive : ""}`} onClick={() => upd({ button_size: sz })}>
                        {sz === "small" ? "S" : sz === "medium" ? "M" : "L"}
                      </button>
                    ))}
                  </div>

                  <div className={s.fieldLabel} style={{ marginTop: 12 }}>Форма</div>
                  <div className={s.sizeRow}>
                    {(["round", "rounded", "square"] as const).map((r) => (
                      <button key={r} type="button" className={`${s.sizeBtn} ${config.button_radius === r ? s.sizeBtnActive : ""}`} onClick={() => upd({ button_radius: r })}>
                        {r === "round" ? "Круг" : r === "rounded" ? "Скруглённый" : "Квадрат"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Greeting */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Приветствие</div>
                <div className={s.sectionCard}>
                  <textarea className={s.fieldTextarea} value={config.greeting} onChange={(e) => upd({ greeting: e.target.value })} rows={3} />
                </div>
              </div>

              {/* Operator display */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Оператор</div>
                <div className={s.sectionCard}>
                  <Toggle label="Показывать имя" checked={config.show_operator_name} onChange={(v) => upd({ show_operator_name: v })} />
                  <Toggle label="Показывать аватар" checked={config.show_operator_avatar} onChange={(v) => upd({ show_operator_avatar: v })} />
                </div>
              </div>

              {/* Behavior */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Поведение</div>
                <div className={s.sectionCard}>
                  <div className={s.field}>
                    <div className={s.fieldLabel}>Авто-открытие (0 = выкл)</div>
                    <div className={s.numberRow}>
                      <input type="number" className={s.numberInput} value={config.auto_open_delay} onChange={(e) => upd({ auto_open_delay: Math.max(0, +e.target.value) })} min={0} max={300} />
                      <span className={s.numberUnit}>сек</span>
                    </div>
                  </div>
                  <Toggle label="Скрыть на мобильных" checked={config.hide_on_mobile} onChange={(v) => upd({ hide_on_mobile: v })} />
                </div>
              </div>

              {/* Custom CSS */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Кастомный CSS</div>
                <div className={s.sectionCard}>
                  <div className={s.cssWarning}>
                    <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
                    Неправильный CSS может сломать виджет
                  </div>
                  <textarea className={s.fieldTextarea} value={config.custom_css} onChange={(e) => upd({ custom_css: e.target.value })} rows={4} style={{ fontFamily: "monospace", fontSize: 12 }} />
                </div>
              </div>
            </>
          )}

          {/* ══ TAB: Prechat ══ */}
          {tab === "prechat" && (
            <>
              <div className={s.section}>
                <div className={s.sectionTitle}>Пречат-форма</div>
                <div className={s.sectionCard}>
                  <Toggle label="Включить пречат-форму" checked={prechat.enabled} onChange={(v) => setPrechat((p) => ({ ...p, enabled: v }))} />
                </div>
              </div>

              {prechat.enabled && (
                <div className={s.section}>
                  <div className={s.sectionTitle}>Поля формы</div>
                  <div className={s.sectionCard}>
                    {prechat.fields.map((field, idx) => (
                      <div key={idx} className={s.prechatFieldRow}>
                        <div style={{ flex: 1 }}>
                          <input className={s.fieldInput} value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })} placeholder="Название поля" style={{ marginBottom: 6 }} />
                          <div style={{ display: "flex", gap: 8 }}>
                            <select className={s.fieldSelect} value={field.type} onChange={(e) => updateField(idx, { type: e.target.value as PrechatField["type"] })} style={{ width: 120 }}>
                              <option value="text">Текст</option>
                              <option value="email">Email</option>
                              <option value="tel">Телефон</option>
                              <option value="textarea">Textarea</option>
                              <option value="select">Выбор</option>
                            </select>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
                              <input type="checkbox" checked={field.required} onChange={(e) => updateField(idx, { required: e.target.checked })} />
                              Обяз.
                            </label>
                          </div>
                          <input className={s.fieldInput} value={field.placeholder || ""} onChange={(e) => updateField(idx, { placeholder: e.target.value })} placeholder="Placeholder" style={{ marginTop: 6 }} />
                        </div>
                        <button className={`${s.prechatFieldBtn} ${s.prechatFieldBtnDanger}`} onClick={() => removeField(idx)}>
                          <Trash2 style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    ))}
                    <button className={s.addFieldBtn} onClick={addField}>
                      <Plus style={{ width: 14, height: 14 }} /> Добавить поле
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ TAB: Hours ══ */}
          {tab === "hours" && (
            <>
              <div className={s.section}>
                <div className={s.sectionTitle}>Рабочие часы</div>
                <div className={s.sectionCard}>
                  <Toggle label="Включить рабочие часы" checked={hours.enabled} onChange={(v) => setHours((p) => ({ ...p, enabled: v }))} />
                </div>
              </div>

              {hours.enabled && (
                <>
                  <div className={s.section}>
                    <div className={s.sectionTitle}>Расписание</div>
                    <div className={s.sectionCard}>
                      {(Object.keys(DAY_LABELS) as (keyof typeof hours.schedule)[]).map((day) => {
                        const d = hours.schedule[day];
                        return (
                          <div key={day} className={`${s.scheduleRow} ${!d.enabled ? s.scheduleDayOff : ""}`}>
                            <div className={s.scheduleDay}>{DAY_LABELS[day]}</div>
                            <Toggle label="" checked={d.enabled} onChange={(v) => updateDay(day, { enabled: v })} />
                            <input type="time" className={s.scheduleTime} value={d.from} disabled={!d.enabled} onChange={(e) => updateDay(day, { from: e.target.value })} />
                            <span className={s.scheduleSep}>—</span>
                            <input type="time" className={s.scheduleTime} value={d.to} disabled={!d.enabled} onChange={(e) => updateDay(day, { to: e.target.value })} />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionTitle}>Часовой пояс</div>
                    <div className={s.sectionCard}>
                      <select className={s.fieldSelect} value={hours.timezone} onChange={(e) => setHours((p) => ({ ...p, timezone: e.target.value }))}>
                        <option value="Europe/Moscow">Москва (UTC+3)</option>
                        <option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
                        <option value="Europe/Samara">Самара (UTC+4)</option>
                        <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
                        <option value="Asia/Omsk">Омск (UTC+6)</option>
                        <option value="Asia/Krasnoyarsk">Красноярск (UTC+7)</option>
                        <option value="Asia/Irkutsk">Иркутск (UTC+8)</option>
                        <option value="Asia/Yakutsk">Якутск (UTC+9)</option>
                        <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
                        <option value="Asia/Kamchatka">Камчатка (UTC+12)</option>
                        <option value="Europe/Kiev">Киев (UTC+2)</option>
                        <option value="Europe/Minsk">Минск (UTC+3)</option>
                        <option value="Asia/Almaty">Алматы (UTC+6)</option>
                        <option value="Asia/Tashkent">Ташкент (UTC+5)</option>
                      </select>
                    </div>
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionTitle}>Оффлайн-сообщение</div>
                    <div className={s.sectionCard}>
                      <textarea className={s.fieldTextarea} value={hours.offline_message} onChange={(e) => setHours((p) => ({ ...p, offline_message: e.target.value }))} rows={3} placeholder="Мы сейчас офлайн..." />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ══ TAB: Domains ══ */}
          {tab === "domains" && (
            <>
              <div className={s.section}>
                <div className={s.sectionTitle}>Ограничение по доменам</div>
                <div className={s.sectionCard}>
                  <Toggle label="Включить ограничение доменов" checked={domains.enabled} onChange={(v) => setDomains((p) => ({ ...p, enabled: v }))} />
                </div>
              </div>

              {domains.enabled && (
                <div className={s.section}>
                  <div className={s.sectionTitle}>Разрешённые домены</div>
                  <div className={s.sectionCard}>
                    {domains.domains.map((domain, idx) => (
                      <div key={idx} className={s.domainRow}>
                        <input className={s.domainInput} value={domain} onChange={(e) => updateDomain(idx, e.target.value)} placeholder="example.com" />
                        <button className={s.domainRemoveBtn} onClick={() => removeDomain(idx)}>
                          <X style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    ))}
                    <button className={s.addFieldBtn} onClick={addDomain}>
                      <Plus style={{ width: 14, height: 14 }} /> Добавить домен
                    </button>
                  </div>
                </div>
              )}

              <div className={s.section}>
                <div className={s.sectionTitle}>Rate limit</div>
                <div className={s.sectionCard}>
                  <div className={s.field}>
                    <div className={s.fieldLabel}>Макс. запросов в минуту</div>
                    <div className={s.numberRow}>
                      <input type="number" className={s.numberInput} value={domains.rate_limit} onChange={(e) => setDomains((p) => ({ ...p, rate_limit: Math.max(1, +e.target.value) }))} min={1} max={1000} />
                      <span className={s.numberUnit}>запр/мин</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ══ TAB: Embed ══ */}
          {tab === "embed" && (
            <>
              <div className={s.section}>
                <div className={s.sectionTitle}>Код для вставки на сайт</div>
                <div className={s.sectionCard}>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
                    Вставьте этот код перед закрывающим тегом <code>&lt;/body&gt;</code> на каждой странице вашего сайта.
                  </p>
                  <div className={s.embedCode}>
                    {getWidgetEmbedCode(API_BASE)}
                    <button type="button" className={s.embedCopyBtn} onClick={() => void handleCopyEmbed()}>
                      {copied ? (<><Check style={{ width: 12, height: 12 }} /> Скопировано</>) : (<><Copy style={{ width: 12, height: 12 }} /> Копировать</>)}
                    </button>
                  </div>
                </div>
              </div>

              <div className={s.section}>
                <div className={s.sectionTitle}>Инструкция</div>
                <div className={s.sectionCard}>
                  <ol style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
                    <li>Скопируйте код выше</li>
                    <li>Откройте HTML-код вашего сайта</li>
                    <li>Вставьте перед <code>&lt;/body&gt;</code></li>
                    <li>Сохраните и обновите страницу</li>
                    <li>Виджет чата появится в правом нижнем углу</li>
                  </ol>
                </div>
              </div>
            </>
          )}

          {/* ── Save button (не показываем на вкладке "Код") ── */}
          {tab !== "embed" && (
            <button
              className={`${s.saveBtn} ${saved ? s.saveBtnSaved : ""}`}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              <Save style={{ width: 14, height: 14 }} />
              {saved ? "Сохранено ✓" : saving ? "Сохранение..." : "Сохранить настройки"}
            </button>
          )}
        </div>

        {/* ═══ Right: Live Preview ═══ */}
        <div className={s.preview}>
          <div className={s.previewTitle}>Предпросмотр</div>

          <div className={s.previewSite}>
            <div className={s.previewSiteBar}>
              <div className={s.previewDot} style={{ background: "#ef4444" }} />
              <div className={s.previewDot} style={{ background: "#eab308" }} />
              <div className={s.previewDot} style={{ background: "#22c55e" }} />
            </div>

            {/* Chat window */}
            <div
              className={s.previewChat}
              style={{ [posRight ? "right" : "left"]: 16, bottom: 80 }}
            >
              <div className={s.previewChatHeader} style={{ background: config.color }}>
                {config.header_title || "Онлайн-чат"}
              </div>
              <div className={s.previewChatBody}>
                <div className={s.previewBubble} style={{ background: `${config.color}18`, color: config.color }}>
                  {config.greeting || "Привет!"}
                </div>
              </div>
            </div>

            {/* Float button */}
            <div
              className={s.previewButton}
              style={{
                background: config.color,
                [posRight ? "right" : "left"]: 16,
                bottom: 16,
                width: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
                height: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
                borderRadius: config.button_radius === "round" ? "50%" : config.button_radius === "rounded" ? 16 : 8,
              }}
            >
              {config.button_icon === "chat" && <MessageCircle style={{ width: 24, height: 24 }} />}
              {config.button_icon === "help" && <HelpCircle style={{ width: 24, height: 24 }} />}
              {config.button_icon === "custom" && <Sparkles style={{ width: 24, height: 24 }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}