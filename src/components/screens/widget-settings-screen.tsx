import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft, Save, MessageCircle, HelpCircle, Sparkles,
  Copy, Check, AlertTriangle, X, Plus,
  Palette, FileText, Clock, Globe, Code, Trash2,
  Zap, Bot, Mail, Phone,
} from "lucide-react";
import { useNavigationStore } from "@/store/navigation.store";
import {
  getWidgetConfig, saveWidgetConfig, getWidgetEmbedCode,
  uploadWidgetAvatar,
  getPrechatFormConfig, savePrechatFormConfig,
  getBusinessHours, saveBusinessHours,
  getDomainSettings, saveDomainSettings,
  getABStats, getOfflineLeads,
  type WidgetConfig, type PrechatFormConfig, type PrechatField,
  type BusinessHours, type DaySchedule, type DomainSettings,
  type AutoMessage, type PageRule, type ABStats, type OfflineLead,
} from "@/features/settings/settings.api";
import { API_BASE } from "@/lib/api";
import { Toggle, toast } from "@/components/ui";
import s from "./WidgetSettingsScreen.module.css";

type Tab = "appearance" | "behavior" | "automation" | "prechat" | "hours" | "domains" | "embed";

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "Внешний вид", icon: Palette },
  { id: "behavior", label: "Поведение", icon: Zap },
  { id: "automation", label: "Автоматизация", icon: Bot },
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

const TRIGGER_LABELS: Record<string, string> = {
  first_visit: "🆕 Первый визит",
  return_visit: "🔄 Повторный визит",
  on_page: "📄 На странице",
  after_idle: "😴 Бездействие",
  cart_abandon: "🛒 Брошенная корзина",
};

// Helper for gradient preview
function getPreviewBg(cfg: WidgetConfig) {
  const gt = cfg.gradient_type || "solid";
  const c = cfg.color || "#8b5cf6";
  const gf = cfg.gradient_from || c;
  const gto = cfg.gradient_to || "#ec4899";
  const ga = cfg.gradient_angle || 135;
  if (gt === "gradient") return `linear-gradient(${ga}deg, ${gf}, ${gto})`;
  if (gt === "glass") return "rgba(255,255,255,0.15)";
  if (gt === "animated") return `linear-gradient(270deg, ${gf}, ${gto}, ${gf})`;
  return c;
}

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
    gradient_type: "solid", gradient_from: "#8b5cf6", gradient_to: "#ec4899", gradient_angle: 135,
    theme: "light", custom_bg: "#ffffff", custom_text: "#1f2937", custom_bubble_bg: "#f3f4f6", custom_border: "#e5e7eb",
    open_animation: "slide",
    launcher_type: "icon_only", launcher_text: "Нужна помощь?", launcher_subtext: "Обычно отвечаем за 2 мин",
    launcher_show_avatar: true, launcher_pulse: true,
    font_family: "system", custom_font_url: "",
    triggers: { exit_intent: false, scroll_percent: null, time_on_page: null, page_url_contains: "", inactivity_seconds: null },
    quick_replies_enabled: false, quick_replies: [],
    response_time_enabled: false, response_time_label: "Обычно отвечаем за 2 мин",
    team_mode: false, team_avatars_count: 3, team_label: "Команда поддержки", team_online_text: "{n} онлайн",
    offline_mode: "message_only", offline_redirect_url: "",
    auto_messages: [],
    ab_test_enabled: false,
    ab_variants: { a: { greeting: "Привет! 👋 Чем помочь?", weight: 50 }, b: { greeting: "Здравствуйте! Задайте вопрос 💬", weight: 50 } },
    ab_metric: "message_rate",
    page_rules: [],
    identity_verification: false,
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
  const [abStats, setAbStats] = useState<ABStats[]>([]);
  const [offlineLeads, setOfflineLeads] = useState<OfflineLead[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getWidgetConfig().then(setConfig).catch(() => {}),
      getPrechatFormConfig().then(setPrechat).catch(() => {}),
      getBusinessHours().then(setHours).catch(() => {}),
      getDomainSettings().then(setDomains).catch(() => {}),
      getABStats().then(setAbStats).catch(() => {}),
      getOfflineLeads().then(setOfflineLeads).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const results = await Promise.allSettled([
        saveWidgetConfig(config).then(setConfig),
        savePrechatFormConfig(prechat),
        saveBusinessHours(hours),
        saveDomainSettings(domains),
      ]);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        toast.error(`Ошибка сохранения (${failed.length} из ${results.length})`);
      } else {
        setSaved(true);
        toast.success("Все настройки сохранены");
        setTimeout(() => setSaved(false), 2000);
      }
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
  const updTrigger = (patch: Partial<WidgetConfig["triggers"]>) =>
    setConfig((p) => ({ ...p, triggers: { ...p.triggers, ...patch } }));
  const posRight = config.position === "bottom-right";

  // ── Prechat helpers ──
  const addField = () => {
    setPrechat((p) => ({
      ...p,
      fields: [...p.fields, { name: `field_${Date.now()}`, label: "Новое поле", type: "text", required: false, placeholder: "" }],
    }));
  };
  const updateField = (idx: number, patch: Partial<PrechatField>) => {
    setPrechat((p) => ({ ...p, fields: p.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  };
  const removeField = (idx: number) => {
    setPrechat((p) => ({ ...p, fields: p.fields.filter((_, i) => i !== idx) }));
  };
  const addOption = (fi: number) => {
    setPrechat((p) => ({ ...p, fields: p.fields.map((f, i) => i === fi ? { ...f, options: [...(f.options || []), ""] } : f) }));
  };
  const updateOption = (fi: number, oi: number, val: string) => {
    setPrechat((p) => ({ ...p, fields: p.fields.map((f, i) => i === fi ? { ...f, options: (f.options || []).map((o, j) => j === oi ? val : o) } : f) }));
  };
  const removeOption = (fi: number, oi: number) => {
    setPrechat((p) => ({ ...p, fields: p.fields.map((f, i) => i === fi ? { ...f, options: (f.options || []).filter((_, j) => j !== oi) } : f) }));
  };

  // ── Quick replies helpers ──
  const addQuickReply = () => upd({ quick_replies: [...(config.quick_replies || []), ""] });
  const updateQuickReply = (idx: number, val: string) => upd({ quick_replies: (config.quick_replies || []).map((r, i) => i === idx ? val : r) });
  const removeQuickReply = (idx: number) => upd({ quick_replies: (config.quick_replies || []).filter((_, i) => i !== idx) });
  // ── Auto messages helpers ──
  const addAutoMsg = () => upd({
    auto_messages: [...(config.auto_messages || []), {
      id: `am_${Date.now()}`, enabled: true, trigger: "on_page",
      delay_seconds: 5, message: "Привет! Нужна помощь?",
      sender_name: "Бот", show_once: true,
    }],
  });
  const updateAutoMsg = (idx: number, patch: Partial<AutoMessage>) =>
    upd({ auto_messages: (config.auto_messages || []).map((m, i) => i === idx ? { ...m, ...patch } : m) });
  const removeAutoMsg = (idx: number) =>
    upd({ auto_messages: (config.auto_messages || []).filter((_, i) => i !== idx) });

  // ── Page rules helpers ──
  const addPageRule = () => upd({
    page_rules: [...(config.page_rules || []), {
      id: `pr_${Date.now()}`, pattern: "/pricing", match_type: "contains" as const,
      override: {}, enabled: true,
    }],
  });
  const updatePageRule = (idx: number, patch: Partial<PageRule>) =>
    upd({ page_rules: (config.page_rules || []).map((r, i) => i === idx ? { ...r, ...patch } : r) });
  const removePageRule = (idx: number) =>
    upd({ page_rules: (config.page_rules || []).filter((_, i) => i !== idx) });
  // ── Hours helpers ──
  const updateDay = (day: string, patch: Partial<DaySchedule>) => {
    setHours((p) => ({ ...p, schedule: { ...p.schedule, [day]: { ...p.schedule[day as keyof typeof p.schedule], ...patch } } }));
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
          <button className={s.backBtn} onClick={() => setScreen("settings")}><ArrowLeft style={{ width: 18, height: 18 }} /></button>
          <h1 className={s.headerTitle}>Настройки виджета</h1>
        </div>
        <div style={{ padding: 32, color: "var(--text-muted)" }}>Загрузка…</div>
      </div>
    );
  }

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => setScreen("settings")}><ArrowLeft style={{ width: 18, height: 18 }} /></button>
        <h1 className={s.headerTitle}>Настройки виджета</h1>
      </div>

      <div className={s.tabs}>
        {TABS.map((t) => (
          <button key={t.id} className={`${s.tab} ${tab === t.id ? s.tabActive : ""}`} onClick={() => setTab(t.id)}>
            <t.icon style={{ width: 14, height: 14 }} />
            {t.label}
          </button>
        ))}
      </div>

      <div className={s.main}>
        <div className={`${s.form} scrollbar-thin`}>

          {/* ═══ TAB: APPEARANCE ═══ */}
          {tab === "appearance" && (
            <>
              {/* Avatar */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Аватар виджета</div>
                <div className={s.sectionCard}>
                  <div className={s.avatarSection}>
                    <div className={s.avatarPreview}>
                      {config.avatar_url ? <img src={`${API_BASE}${config.avatar_url}`} alt="avatar" /> : <MessageCircle style={{ width: 24, height: 24, color: "var(--text-muted)" }} />}
                    </div>
                    <div className={s.avatarActions}>
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
                      <button className={s.avatarUploadBtn} onClick={() => fileRef.current?.click()}>Загрузить</button>
                      {config.avatar_url && <button className={s.avatarRemoveBtn} onClick={() => upd({ avatar_url: null })}>Удалить</button>}
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
                    <input className={s.fieldInput} value={config.header_title} onChange={(e) => upd({ header_title: e.target.value })} placeholder="Онлайн-чат" />
                  </div>
                </div>
              </div>

              {/* 1.1 Gradient type */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Стиль кнопки и шапки</div>
                <div className={s.sectionCard}>
                  <div className={s.sizeRow}>
                    {(["solid", "gradient", "glass", "animated"] as const).map((gt) => (
                      <button key={gt} type="button" className={`${s.sizeBtn} ${config.gradient_type === gt ? s.sizeBtnActive : ""}`} onClick={() => upd({ gradient_type: gt })}>
                        {gt === "solid" ? "Одноцветный" : gt === "gradient" ? "Градиент" : gt === "glass" ? "Стекло" : "Анимация"}
                      </button>
                    ))}
                  </div>

                  {config.gradient_type === "gradient" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <div className={s.colorSwatch}><input type="color" className={s.colorInput} value={config.gradient_from} onChange={(e) => upd({ gradient_from: e.target.value })} /></div>
                      <span style={{ fontSize: 18, color: "var(--text-muted)" }}>→</span>
                      <div className={s.colorSwatch}><input type="color" className={s.colorInput} value={config.gradient_to} onChange={(e) => upd({ gradient_to: e.target.value })} /></div>
                      <div style={{ flex: 1 }}>
                        <div className={s.fieldLabel}>Угол: {config.gradient_angle}°</div>
                        <input type="range" min={0} max={360} value={config.gradient_angle} onChange={(e) => upd({ gradient_angle: +e.target.value })} style={{ width: "100%" }} />
                      </div>
                    </div>
                  )}

                  {config.gradient_type === "animated" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <div className={s.colorSwatch}><input type="color" className={s.colorInput} value={config.gradient_from} onChange={(e) => upd({ gradient_from: e.target.value })} /></div>
                      <span style={{ fontSize: 18, color: "var(--text-muted)" }}>⟷</span>
                      <div className={s.colorSwatch}><input type="color" className={s.colorInput} value={config.gradient_to} onChange={(e) => upd({ gradient_to: e.target.value })} /></div>
                    </div>
                  )}

                  {/* Preview strip */}
                  <div style={{ marginTop: 12, height: 32, borderRadius: 8, background: getPreviewBg(config), border: "1px solid var(--border-default)" }} />
                </div>
              </div>

              {/* Color */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Основной цвет</div>
                <div className={s.sectionCard}>
                  <div className={s.colorRow}>
                    <div className={s.colorSwatch}><input type="color" className={s.colorInput} value={config.color} onChange={(e) => upd({ color: e.target.value })} /></div>
                    <input className={s.colorHex} value={config.color} onChange={(e) => upd({ color: e.target.value })} maxLength={7} />
                  </div>
                  <div className={s.colorPresets}>
                    {COLOR_PRESETS.map((c) => (
                      <button key={c} type="button" className={`${s.colorPreset} ${config.color === c ? s.colorPresetActive : ""}`} style={{ background: c }} onClick={() => upd({ color: c })} />
                    ))}
                  </div>
                </div>
              </div>

              {/* 1.2 Theme */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Тема оформления</div>
                <div className={s.sectionCard}>
                  <div className={s.sizeRow}>
                    {(["light", "dark", "auto", "custom"] as const).map((t) => (
                      <button key={t} type="button" className={`${s.sizeBtn} ${config.theme === t ? s.sizeBtnActive : ""}`} onClick={() => upd({ theme: t })}>
                        {t === "light" ? "☀️ Светлая" : t === "dark" ? "🌙 Тёмная" : t === "auto" ? "🔄 Авто" : "🎨 Своя"}
                      </button>
                    ))}
                  </div>
                  {config.theme === "custom" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                      {([
                        ["custom_bg", "Фон чата"],
                        ["custom_text", "Цвет текста"],
                        ["custom_bubble_bg", "Фон сообщений"],
                        ["custom_border", "Цвет границ"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          <div className={s.fieldLabel}>{label}</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <div className={s.colorSwatch} style={{ width: 32, height: 32 }}>
                              <input type="color" className={s.colorInput} value={(config as any)[key] || "#ffffff"} onChange={(e) => upd({ [key]: e.target.value } as any)} />
                            </div>
                            <input className={s.colorHex} value={(config as any)[key] || "#ffffff"} onChange={(e) => upd({ [key]: e.target.value } as any)} maxLength={7} style={{ flex: 1 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 1.3 Open animation */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Анимация открытия</div>
                <div className={s.sectionCard}>
                  <div className={s.sizeRow}>
                    {(["slide", "pop", "fade", "bounce", "flip"] as const).map((a) => (
                      <button key={a} type="button" className={`${s.sizeBtn} ${config.open_animation === a ? s.sizeBtnActive : ""}`} onClick={() => upd({ open_animation: a })}>
                        {a === "slide" ? "↗ Слайд" : a === "pop" ? "💥 Поп" : a === "fade" ? "🌫 Фейд" : a === "bounce" ? "🏀 Баунс" : "🔄 Флип"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 1.4 Launcher type */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Тип лаунчера</div>
                <div className={s.sectionCard}>
                  <div className={s.sizeRow}>
                    {(["icon_only", "icon_text", "text_only", "card"] as const).map((lt) => (
                      <button key={lt} type="button" className={`${s.sizeBtn} ${config.launcher_type === lt ? s.sizeBtnActive : ""}`} onClick={() => upd({ launcher_type: lt })}>
                        {lt === "icon_only" ? "Иконка" : lt === "icon_text" ? "Иконка+текст" : lt === "text_only" ? "Текст" : "Карточка"}
                      </button>
                    ))}
                  </div>
                  {config.launcher_type !== "icon_only" && (
                    <>
                      <div className={s.field} style={{ marginTop: 12 }}>
                        <div className={s.fieldLabel}>Текст лаунчера</div>
                        <input className={s.fieldInput} value={config.launcher_text} onChange={(e) => upd({ launcher_text: e.target.value })} placeholder="Нужна помощь?" />
                      </div>
                      {config.launcher_type === "card" && (
                        <div className={s.field}>
                          <div className={s.fieldLabel}>Подтекст</div>
                          <input className={s.fieldInput} value={config.launcher_subtext} onChange={(e) => upd({ launcher_subtext: e.target.value })} placeholder="Обычно отвечаем за 2 мин" />
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Toggle label="Пульсация кнопки" checked={config.launcher_pulse} onChange={(v) => upd({ launcher_pulse: v })} />
                  </div>
                </div>
              </div>

              {/* 1.5 Font */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Шрифт</div>
                <div className={s.sectionCard}>
                  <div className={s.sizeRow} style={{ flexWrap: "wrap" }}>
                    {(["system", "inter", "roboto", "montserrat", "custom"] as const).map((f) => (
                      <button key={f} type="button" className={`${s.sizeBtn} ${config.font_family === f ? s.sizeBtnActive : ""}`} onClick={() => upd({ font_family: f })}
                        style={{ fontFamily: f === "system" ? "inherit" : f === "custom" ? "inherit" : f, minWidth: 80 }}>
                        {f === "system" ? "Системный" : f === "custom" ? "Свой" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  {config.font_family === "custom" && (
                    <div className={s.field} style={{ marginTop: 10 }}>
                      <div className={s.fieldLabel}>Google Fonts URL</div>
                      <input className={s.fieldInput} value={config.custom_font_url} onChange={(e) => upd({ custom_font_url: e.target.value })} placeholder="https://fonts.googleapis.com/css2?family=Nunito" />
                    </div>
                  )}
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

              {/* Operator */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Оператор</div>
                <div className={s.sectionCard}>
                  <Toggle label="Показывать имя" checked={config.show_operator_name} onChange={(v) => upd({ show_operator_name: v })} />
                  <Toggle label="Показывать аватар" checked={config.show_operator_avatar} onChange={(v) => upd({ show_operator_avatar: v })} />
                </div>
              </div>

              {/* 3.1 Team */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Команда в хедере</div>
                <div className={s.sectionCard}>
                  <Toggle label="Показывать аватары команды" checked={config.team_mode} onChange={(v) => upd({ team_mode: v })} />
                  {config.team_mode && (
                    <>
                      <div className={s.field} style={{ marginTop: 8 }}>
                        <div className={s.fieldLabel}>Название команды</div>
                        <input className={s.fieldInput} value={config.team_label} onChange={(e) => upd({ team_label: e.target.value })} placeholder="Команда поддержки" />
                      </div>
                      <div className={s.field}>
                        <div className={s.fieldLabel}>Текст онлайн ({"{n}"} = кол-во)</div>
                        <input className={s.fieldInput} value={config.team_online_text} onChange={(e) => upd({ team_online_text: e.target.value })} placeholder="{n} онлайн" />
                      </div>
                      <div className={s.field}>
                        <div className={s.fieldLabel}>Макс. аватаров</div>
                        <div className={s.numberRow}>
                          <input type="number" className={s.numberInput} value={config.team_avatars_count} onChange={(e) => upd({ team_avatars_count: Math.max(1, Math.min(10, +e.target.value)) })} min={1} max={10} />
                        </div>
                      </div>
                    </>
                  )}
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

          {/* ═══ TAB: BEHAVIOR ═══ */}
          {tab === "behavior" && (
            <>
              {/* Auto open */}
              <div className={s.section}>
                <div className={s.sectionTitle}>Автооткрытие</div>
                <div className={s.sectionCard}>
                  <div className={s.field}>
                    <div className={s.fieldLabel}>Задержка авто-открытия (0 = выкл)</div>
                    <div className={s.numberRow}>
                      <input type="number" className={s.numberInput} value={config.auto_open_delay} onChange={(e) => upd({ auto_open_delay: Math.max(0, +e.target.value) })} min={0} max={300} />
                      <span className={s.numberUnit}>сек</span>
                    </div>
                  </div>
                  <Toggle label="Скрыть на мобильных" checked={config.hide_on_mobile} onChange={(v) => upd({ hide_on_mobile: v })} />
                </div>
              </div>

              {/* 2.1 Triggers */}
              <div className={s.section}>
                <div className={s.sectionTitle}>🎯 Умные триггеры</div>
                <div className={s.sectionCard}>
                  {/* Exit intent */}
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <Toggle label="🖱️ Exit Intent — при уходе курсора со страницы" checked={config.triggers.exit_intent} onChange={(v) => updTrigger({ exit_intent: v })} />
                  </div>

                  {/* Scroll */}
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <Toggle label="📜 Скролл страницы" checked={config.triggers.scroll_percent !== null} onChange={(v) => updTrigger({ scroll_percent: v ? 50 : null })} />
                    {config.triggers.scroll_percent !== null && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <input type="range" min={10} max={90} value={config.triggers.scroll_percent} onChange={(e) => updTrigger({ scroll_percent: +e.target.value })} style={{ flex: 1 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36 }}>{config.triggers.scroll_percent}%</span>
                      </div>
                    )}
                  </div>

                  {/* Time on page */}
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <Toggle label="⏱️ Время на странице" checked={config.triggers.time_on_page !== null} onChange={(v) => updTrigger({ time_on_page: v ? 30 : null })} />
                    {config.triggers.time_on_page !== null && (
                      <div className={s.numberRow} style={{ marginTop: 8 }}>
                        <input type="number" className={s.numberInput} value={config.triggers.time_on_page} onChange={(e) => updTrigger({ time_on_page: Math.max(1, +e.target.value) })} min={1} max={600} />
                        <span className={s.numberUnit}>сек</span>
                      </div>
                    )}
                  </div>

                  {/* Inactivity */}
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <Toggle label="😴 Бездействие пользователя" checked={config.triggers.inactivity_seconds !== null} onChange={(v) => updTrigger({ inactivity_seconds: v ? 30 : null })} />
                    {config.triggers.inactivity_seconds !== null && (
                      <div className={s.numberRow} style={{ marginTop: 8 }}>
                        <input type="number" className={s.numberInput} value={config.triggers.inactivity_seconds} onChange={(e) => updTrigger({ inactivity_seconds: Math.max(5, +e.target.value) })} min={5} max={600} />
                        <span className={s.numberUnit}>сек</span>
                      </div>
                    )}
                  </div>

                  {/* Page URL contains */}
                  <div style={{ padding: "10px 0" }}>
                    <div className={s.fieldLabel}>📄 Показывать только на страницах (через запятую)</div>
                    <input className={s.fieldInput} value={config.triggers.page_url_contains} onChange={(e) => updTrigger({ page_url_contains: e.target.value })} placeholder="/pricing, /checkout, /help" style={{ marginTop: 6 }} />
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Пусто = на всех страницах</div>
                  </div>
                </div>
              </div>

              {/* 2.2 Quick replies */}
              <div className={s.section}>
                <div className={s.sectionTitle}>⚡ Быстрые ответы</div>
                <div className={s.sectionCard}>
                  <Toggle label="Показывать кнопки быстрых ответов" checked={config.quick_replies_enabled} onChange={(v) => upd({ quick_replies_enabled: v })} />
                  {config.quick_replies_enabled && (
                    <>
                      {(config.quick_replies || []).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
                          {(config.quick_replies || []).map((r, i) => (
                            <span key={i} style={{ padding: "4px 12px", borderRadius: 16, border: `1.5px solid ${config.color}`, color: config.color, fontSize: 12, fontWeight: 600 }}>{r || "..."}</span>
                          ))}
                        </div>
                      )}
                      {(config.quick_replies || []).map((reply, idx) => (
                        <div key={idx} className={s.domainRow}>
                          <input className={s.domainInput} value={reply} onChange={(e) => updateQuickReply(idx, e.target.value)} placeholder="Текст кнопки..." />
                          <button className={s.domainRemoveBtn} onClick={() => removeQuickReply(idx)}><X style={{ width: 14, height: 14 }} /></button>
                        </div>
                      ))}
                      <button className={s.addFieldBtn} onClick={addQuickReply}><Plus style={{ width: 14, height: 14 }} /> Добавить кнопку</button>
                    </>
                  )}
                </div>
              </div>

              {/* 2.3 Response time */}
              <div className={s.section}>
                <div className={s.sectionTitle}>⏳ Время ответа</div>
                <div className={s.sectionCard}>
                  <Toggle label="Показывать время ответа в хедере" checked={config.response_time_enabled} onChange={(v) => upd({ response_time_enabled: v })} />
                  {config.response_time_enabled && (
                    <div className={s.field} style={{ marginTop: 8 }}>
                      <div className={s.fieldLabel}>Текст</div>
                      <input className={s.fieldInput} value={config.response_time_label} onChange={(e) => upd({ response_time_label: e.target.value })} placeholder="Обычно отвечаем за 2 мин" />
                    </div>
                  )}
                </div>
              </div>

              {/* 4.1 Offline mode */}
              <div className={s.section}>
                <div className={s.sectionTitle}>📴 Офлайн-режим</div>
                <div className={s.sectionCard}>
                  <div className={s.fieldLabel}>Что показывать когда офлайн</div>
                  <div className={s.sizeRow} style={{ marginTop: 6 }}>
                    {(["message_only", "email_capture", "callback_request", "redirect"] as const).map((m) => (
                      <button key={m} type="button" className={`${s.sizeBtn} ${config.offline_mode === m ? s.sizeBtnActive : ""}`} onClick={() => upd({ offline_mode: m })} style={{ fontSize: 11 }}>
                        {m === "message_only" ? "Сообщение" : m === "email_capture" ? "Сбор email" : m === "callback_request" ? "Обратный звонок" : "Редирект"}
                      </button>
                    ))}
                  </div>
                  {config.offline_mode === "redirect" && (
                    <div className={s.field} style={{ marginTop: 10 }}>
                      <div className={s.fieldLabel}>URL для редиректа</div>
                      <input className={s.fieldInput} value={config.offline_redirect_url} onChange={(e) => upd({ offline_redirect_url: e.target.value })} placeholder="https://example.com/contact" />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═══ TAB: AUTOMATION ═══ */}
          {tab === "automation" && (
            <>
              {/* 2.2 Auto messages */}
              <div className={s.section}>
                <div className={s.sectionTitle}>🤖 Автосообщения по сценариям</div>
                <div className={s.sectionCard}>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
                    Настройте автоматические сообщения по событиям. Бот отправит их от своего имени.
                  </p>

                  {(config.auto_messages || []).map((am, idx) => (
                    <div key={am.id} style={{ padding: 12, border: "1px solid var(--border-default)", borderRadius: 12, marginBottom: 10, background: am.enabled ? "var(--bg-primary)" : "var(--bg-secondary)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Toggle label="" checked={am.enabled} onChange={(v) => updateAutoMsg(idx, { enabled: v })} />
                        <span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--bg-tertiary)", fontSize: 11, fontWeight: 600 }}>
                          {TRIGGER_LABELS[am.trigger] || am.trigger}
                        </span>
                        <div style={{ flex: 1 }} />
                        <button className={s.domainRemoveBtn} onClick={() => removeAutoMsg(idx)}><Trash2 style={{ width: 14, height: 14 }} /></button>
                      </div>

                      <select className={s.fieldSelect} value={am.trigger} onChange={(e) => updateAutoMsg(idx, { trigger: e.target.value as AutoMessage["trigger"] })} style={{ marginBottom: 6 }}>
                        <option value="first_visit">🆕 Первый визит</option>
                        <option value="return_visit">🔄 Повторный визит</option>
                        <option value="on_page">📄 На странице</option>
                        <option value="after_idle">😴 Бездействие</option>
                        <option value="cart_abandon">🛒 Брошенная корзина</option>
                      </select>

                      <textarea className={s.fieldTextarea} value={am.message} onChange={(e) => updateAutoMsg(idx, { message: e.target.value })} rows={2} placeholder="Текст сообщения..." style={{ marginBottom: 6 }} />

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <div className={s.fieldLabel}>Задержка</div>
                          <div className={s.numberRow}>
                            <input type="number" className={s.numberInput} value={am.delay_seconds} onChange={(e) => updateAutoMsg(idx, { delay_seconds: Math.max(0, +e.target.value) })} min={0} max={300} />
                            <span className={s.numberUnit}>сек</span>
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <div className={s.fieldLabel}>От имени</div>
                          <input className={s.fieldInput} value={am.sender_name} onChange={(e) => updateAutoMsg(idx, { sender_name: e.target.value })} placeholder="Бот" />
                        </div>
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <div className={s.fieldLabel}>Только на страницах (через запятую, пусто = все)</div>
                        <input className={s.fieldInput} value={am.page_filter || ""} onChange={(e) => updateAutoMsg(idx, { page_filter: e.target.value })} placeholder="/pricing, /checkout" />
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <Toggle label="Показывать только один раз" checked={am.show_once} onChange={(v) => updateAutoMsg(idx, { show_once: v })} />
                      </div>
                    </div>
                  ))}

                  <button className={s.addFieldBtn} onClick={addAutoMsg}>
                    <Plus style={{ width: 14, height: 14 }} /> Новый сценарий
                  </button>
                </div>
              </div>

              {/* 4.2 A/B testing */}
              <div className={s.section}>
                <div className={s.sectionTitle}>🧪 A/B тестирование приветствий</div>
                <div className={s.sectionCard}>
                  <Toggle label="Включить A/B тест" checked={config.ab_test_enabled} onChange={(v) => upd({ ab_test_enabled: v })} />

                  {config.ab_test_enabled && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                        <div style={{ padding: 10, border: "2px solid #8b5cf6", borderRadius: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#8b5cf6", marginBottom: 4 }}>Вариант A</div>
                          <textarea className={s.fieldTextarea} value={config.ab_variants?.a?.greeting || ""} onChange={(e) => upd({ ab_variants: { ...config.ab_variants, a: { ...config.ab_variants.a, greeting: e.target.value } } })} rows={2} />
                          <div className={s.numberRow} style={{ marginTop: 6 }}>
                            <span className={s.fieldLabel}>Вес:</span>
                            <input type="number" className={s.numberInput} value={config.ab_variants?.a?.weight || 50} onChange={(e) => upd({ ab_variants: { ...config.ab_variants, a: { ...config.ab_variants.a, weight: +e.target.value } } })} min={0} max={100} style={{ width: 60 }} />
                            <span className={s.numberUnit}>%</span>
                          </div>
                        </div>
                        <div style={{ padding: 10, border: "2px solid #ec4899", borderRadius: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#ec4899", marginBottom: 4 }}>Вариант B</div>
                          <textarea className={s.fieldTextarea} value={config.ab_variants?.b?.greeting || ""} onChange={(e) => upd({ ab_variants: { ...config.ab_variants, b: { ...config.ab_variants.b, greeting: e.target.value } } })} rows={2} />
                          <div className={s.numberRow} style={{ marginTop: 6 }}>
                            <span className={s.fieldLabel}>Вес:</span>
                            <input type="number" className={s.numberInput} value={config.ab_variants?.b?.weight || 50} onChange={(e) => upd({ ab_variants: { ...config.ab_variants, b: { ...config.ab_variants.b, weight: +e.target.value } } })} min={0} max={100} style={{ width: 60 }} />
                            <span className={s.numberUnit}>%</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <div className={s.fieldLabel}>Метрика успеха</div>
                        <div className={s.sizeRow}>
                          {(["open_rate", "message_rate", "rating"] as const).map((m) => (
                            <button key={m} type="button" className={`${s.sizeBtn} ${config.ab_metric === m ? s.sizeBtnActive : ""}`} onClick={() => upd({ ab_metric: m })}>
                              {m === "open_rate" ? "Открытия" : m === "message_rate" ? "Сообщения" : "Оценки"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Stats */}
                      {abStats.length > 0 && (
                        <div style={{ marginTop: 12, padding: 10, background: "var(--bg-secondary)", borderRadius: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>📊 Результаты (30 дней)</div>
                          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                                <th style={{ textAlign: "left", padding: 4 }}>Вариант</th>
                                <th style={{ textAlign: "left", padding: 4 }}>Событие</th>
                                <th style={{ textAlign: "right", padding: 4 }}>Кол-во</th>
                              </tr>
                            </thead>
                            <tbody>
                              {abStats.map((st, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                                  <td style={{ padding: 4, fontWeight: 600, color: st.variant === "a" ? "#8b5cf6" : "#ec4899" }}>{st.variant.toUpperCase()}</td>
                                  <td style={{ padding: 4 }}>{st.event === "opened" ? "Открыл" : st.event === "messaged" ? "Написал" : st.event}</td>
                                  <td style={{ padding: 4, textAlign: "right", fontWeight: 700 }}>{st.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 6.1 Page rules */}
              <div className={s.section}>
                <div className={s.sectionTitle}>📄 Правила для страниц</div>
                <div className={s.sectionCard}>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
                    Переопределяйте настройки виджета для конкретных страниц (цвет, приветствие и т.д.)
                  </p>

                  {(config.page_rules || []).map((rule, idx) => (
                    <div key={rule.id} style={{ padding: 12, border: "1px solid var(--border-default)", borderRadius: 12, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <Toggle label="" checked={rule.enabled} onChange={(v) => updatePageRule(idx, { enabled: v })} />
                        <select className={s.fieldSelect} value={rule.match_type} onChange={(e) => updatePageRule(idx, { match_type: e.target.value as PageRule["match_type"] })} style={{ width: 120 }}>
                          <option value="contains">Содержит</option>
                          <option value="exact">Точно</option>
                          <option value="regex">Regex</option>
                        </select>
                        <input className={s.fieldInput} value={rule.pattern} onChange={(e) => updatePageRule(idx, { pattern: e.target.value })} placeholder="/pricing" style={{ flex: 1 }} />
                        <button className={s.domainRemoveBtn} onClick={() => removePageRule(idx)}><Trash2 style={{ width: 14, height: 14 }} /></button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div className={s.fieldLabel}>Цвет (пусто = по умолч.)</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <div className={s.colorSwatch} style={{ width: 28, height: 28 }}>
                              <input type="color" className={s.colorInput} value={(rule.override as any).color || config.color} onChange={(e) => updatePageRule(idx, { override: { ...rule.override, color: e.target.value } })} />
                            </div>
                            <button style={{ fontSize: 11, color: "var(--text-muted)", cursor: "pointer", background: "none", border: "none" }} onClick={() => {
                              const { color: _, ...rest } = rule.override as any;
                              updatePageRule(idx, { override: rest });
                            }}>✕</button>
                          </div>
                        </div>
                        <div>
                          <div className={s.fieldLabel}>Приветствие</div>
                          <input className={s.fieldInput} value={(rule.override as any).greeting || ""} onChange={(e) => updatePageRule(idx, { override: { ...rule.override, greeting: e.target.value } })} placeholder="По умолч." style={{ fontSize: 12 }} />
                        </div>
                      </div>
                    </div>
                  ))}

                  <button className={s.addFieldBtn} onClick={addPageRule}>
                    <Plus style={{ width: 14, height: 14 }} /> Добавить правило
                  </button>
                </div>
              </div>

              {/* 6.3 Identity verification */}
              <div className={s.section}>
                <div className={s.sectionTitle}>🔐 Идентификация пользователей</div>
                <div className={s.sectionCard}>
                  <Toggle label="Читать window.ZSConfig.user" checked={config.identity_verification} onChange={(v) => upd({ identity_verification: v })} />
                  {config.identity_verification && (
                    <div style={{ marginTop: 10, padding: 10, background: "var(--bg-secondary)", borderRadius: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Код для авторизованных пользователей:</div>
                      <pre style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, overflow: "auto", background: "var(--bg-primary)", padding: 10, borderRadius: 8, border: "1px solid var(--border-default)" }}>
{`<script>
  window.ZSConfig = {
    user: {
      id: "USER_ID",
      name: "USER_NAME",
      email: "USER_EMAIL",
    }
  };
</script>
<script src="${API_BASE}/widget.js" async></script>`}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Offline leads list */}
              {offlineLeads.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionTitle}>📬 Офлайн-обращения ({offlineLeads.length})</div>
                  <div className={s.sectionCard}>
                    {offlineLeads.slice(0, 20).map((lead) => (
                      <div key={lead.id} style={{ padding: 10, borderBottom: "1px solid var(--border-light)", fontSize: 12 }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                          {lead.name && <span style={{ fontWeight: 700 }}>{lead.name}</span>}
                          {lead.email && <span style={{ color: "var(--text-muted)" }}><Mail style={{ width: 12, height: 12, display: "inline", verticalAlign: "middle" }} /> {lead.email}</span>}
                          {lead.phone && <span style={{ color: "var(--text-muted)" }}><Phone style={{ width: 12, height: 12, display: "inline", verticalAlign: "middle" }} /> {lead.phone}</span>}
                        </div>
                        {lead.message && <div style={{ color: "var(--text-secondary)" }}>{lead.message}</div>}
                        {lead.preferred_time && <div style={{ color: "#f59e0b", fontSize: 11 }}>🕐 {lead.preferred_time}</div>}
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{new Date(lead.created_at).toLocaleString("ru-RU")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══ TAB: PRECHAT ═══ */}
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
                          {field.type === "select" && (
                            <div style={{ marginTop: 8, paddingLeft: 4 }}>
                              <div className={s.fieldLabel}>Опции выбора</div>
                              {(field.options || []).map((opt, optIdx) => (
                                <div key={optIdx} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                                  <input className={s.fieldInput} value={opt} onChange={(e) => updateOption(idx, optIdx, e.target.value)} placeholder={`Опция ${optIdx + 1}`} />
                                  <button className={`${s.prechatFieldBtn} ${s.prechatFieldBtnDanger}`} onClick={() => removeOption(idx, optIdx)} style={{ flexShrink: 0 }}>
                                    <X style={{ width: 12, height: 12 }} />
                                  </button>
                                </div>
                              ))}
                              <button className={s.addFieldBtn} onClick={() => addOption(idx)} style={{ marginTop: 4, fontSize: 11, padding: "4px 10px" }}>
                                <Plus style={{ width: 12, height: 12 }} /> Добавить опцию
                              </button>
                            </div>
                          )}
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

          {/* ═══ TAB: HOURS ═══ */}
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

          {/* ═══ TAB: DOMAINS ═══ */}
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
                        <button className={s.domainRemoveBtn} onClick={() => removeDomain(idx)}><X style={{ width: 14, height: 14 }} /></button>
                      </div>
                    ))}
                    <button className={s.addFieldBtn} onClick={addDomain}><Plus style={{ width: 14, height: 14 }} /> Добавить домен</button>
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

          {/* ═══ TAB: EMBED ═══ */}
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

          {/* Save button */}
          {tab !== "embed" && (
            <button className={`${s.saveBtn} ${saved ? s.saveBtnSaved : ""}`} onClick={() => void handleSave()} disabled={saving}>
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
            <div className={s.previewChat} style={{ [posRight ? "right" : "left"]: 16, bottom: 80 }}>
              <div className={s.previewChatHeader} style={{ background: getPreviewBg(config) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                    {config.avatar_url ? <img src={`${API_BASE}${config.avatar_url}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <MessageCircle style={{ width: 16, height: 16, color: "#fff" }} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{config.team_mode ? (config.team_label || "Команда") : (config.header_title || "Онлайн-чат")}</div>
                    <div style={{ fontSize: 10, opacity: 0.8, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                      {config.team_mode ? (config.team_online_text || "{n} онлайн").replace("{n}", "3") : "Онлайн"}
                    </div>
                    {config.response_time_enabled && config.response_time_label && (
                      <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>{config.response_time_label}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className={s.previewChatBody}>
                {tab === "prechat" && prechat.enabled ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                    <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "#1f2937" }}>Привет! 👋</div>
                    {prechat.fields.slice(0, 3).map((f, i) => (
                      <div key={i} style={{ width: "100%" }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>{f.label}{f.required && <span style={{ color: "#ef4444" }}> *</span>}</div>
                        <div style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 11, color: "#9ca3af" }}>
                          {f.type === "select" ? "Выберите..." : (f.placeholder || f.label)}
                        </div>
                      </div>
                    ))}
                    {prechat.fields.length > 3 && <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "center" }}>+{prechat.fields.length - 3} ещё...</div>}
                    <div style={{ padding: "8px 12px", borderRadius: 10, background: config.color, color: "#fff", textAlign: "center", fontSize: 12, fontWeight: 600 }}>Начать чат</div>
                  </div>
                ) : (
                  <>
                    <div className={s.previewBubble} style={{ background: `${config.color}18`, color: config.color }}>{config.greeting || "Привет!"}</div>
                    {config.quick_replies_enabled && (config.quick_replies || []).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {(config.quick_replies || []).slice(0, 3).map((r, i) => (
                          <span key={i} style={{ padding: "3px 8px", borderRadius: 12, border: `1px solid ${config.color}`, color: config.color, fontSize: 10, fontWeight: 600 }}>{r || "..."}</span>
                        ))}
                      </div>
                    )}
                    {tab === "hours" && hours.enabled && (
                      <div style={{ padding: "6px 10px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 600, textAlign: "center", marginTop: 4 }}>
                        {hours.offline_message || "Мы сейчас офлайн"}
                      </div>
                    )}
                    {tab === "behavior" && config.triggers.exit_intent && (
                      <div style={{ padding: "4px 8px", borderRadius: 6, background: "#ede9fe", color: "#7c3aed", fontSize: 10, textAlign: "center", marginTop: 4 }}>
                        🖱️ Exit intent активен
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* FAB button */}
            <div className={s.previewButton} style={{
              background: getPreviewBg(config),
              [posRight ? "right" : "left"]: 16,
              bottom: 16,
              width: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
              height: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
              borderRadius: config.button_radius === "round" ? "50%" : config.button_radius === "rounded" ? 16  : 8,
            }}>
              {config.button_icon === "chat" && <MessageCircle style={{ width: 24, height: 24 }} />}
              {config.button_icon === "help" && <HelpCircle style={{ width: 24, height: 24 }} />}
              {config.button_icon === "custom" && <Sparkles style={{ width: 24, height: 24 }} />}
            </div>

            {/* Launcher card preview */}
            {config.launcher_type === "card" && (
              <div style={{
                position: "absolute",
                [posRight ? "right" : "left"]: 80,
                bottom: 20,
                background: "#fff",
                borderRadius: 12,
                padding: "8px 12px",
                boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                maxWidth: 180,
                border: "1px solid #f0f0f0",
              }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: config.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <MessageCircle style={{ width: 14, height: 14, color: "#fff" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1f2937", lineHeight: 1.2 }}>{config.launcher_text || "Нужна помощь?"}</div>
                  {config.launcher_subtext && <div style={{ fontSize: 9, color: "#6b7280", marginTop: 1 }}>{config.launcher_subtext}</div>}
                </div>
              </div>
            )}

            {/* Icon+text launcher preview */}
            {config.launcher_type === "icon_text" && (
              <div style={{
                position: "absolute",
                [posRight ? "right" : "left"]: 16,
                bottom: 16,
                background: getPreviewBg(config),
                borderRadius: 28,
                padding: "0 16px 0 12px",
                height: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "#fff",
                boxShadow: `0 4px 16px ${config.color}50`,
              }}>
                <MessageCircle style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{config.launcher_text || "Помощь"}</span>
              </div>
            )}

            {/* Text only launcher preview */}
            {config.launcher_type === "text_only" && (
              <div style={{
                position: "absolute",
                [posRight ? "right" : "left"]: 16,
                bottom: 16,
                background: getPreviewBg(config),
                borderRadius: 28,
                padding: "0 20px",
                height: config.button_size === "small" ? 48 : config.button_size === "large" ? 64 : 56,
                display: "flex",
                alignItems: "center",
                color: "#fff",
                boxShadow: `0 4px 16px ${config.color}50`,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{config.launcher_text || "Помощь"}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}