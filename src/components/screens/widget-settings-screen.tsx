import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Save,
  MessageCircle,
  HelpCircle,
  Sparkles,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useNavigationStore } from "@/store/navigation.store";
import {
  getWidgetConfig,
  saveWidgetConfig,
  getWidgetEmbedCode,
  type WidgetConfig,
} from "@/features/settings/settings.api";
import { API_BASE } from "@/lib/api";
import { Toggle, toast } from "@/components/ui";
import s from "./WidgetSettingsScreen.module.css";

const COLOR_PRESETS = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9",
  "#14b8a6", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#ec4899", "#a855f7", "#1e293b",
];

export function WidgetSettingsScreen() {
  const setScreen = useNavigationStore((st) => st.setScreen);

  const [config, setConfig] = useState<WidgetConfig>({
    position: "bottom-right",
    color: "#8b5cf6",
    greeting: "Привет! Чем помочь?",
    avatar_url: null,
    show_operator_name: true,
    show_operator_avatar: true,
    button_icon: "chat",
    button_text: "",
    auto_open_delay: 0,
    hide_on_mobile: false,
    custom_css: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    getWidgetConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const result = await saveWidgetConfig(config);
      setConfig(result);
      setSaved(true);
      toast.success("Настройки виджета сохранены");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyEmbed = async () => {
    const code = getWidgetEmbedCode(API_BASE);
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Код скопирован");
    setTimeout(() => setCopied(false), 2000);
  };

  const update = (patch: Partial<WidgetConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const posRight = config.position === "bottom-right";

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
      {/* ── Header ── */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => setScreen("settings")}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <h1 className={s.headerTitle}>Настройки виджета</h1>
      </div>

      <div className={s.main}>
        {/* ══════ Left: Form ══════ */}
        <div className={`${s.form} scrollbar-thin`}>
          {/* ── Цвет ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Цвет</div>
            <div className={s.sectionCard}>
              <div className={s.colorRow}>
                <div className={s.colorSwatch}>
                  <input
                    type="color"
                    className={s.colorInput}
                    value={config.color}
                    onChange={(e) => update({ color: e.target.value })}
                  />
                </div>
                <input
                  className={s.colorHex}
                  value={config.color}
                  onChange={(e) => update({ color: e.target.value })}
                  maxLength={7}
                />
              </div>
              <div className={s.colorPresets}>
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${s.colorPreset} ${config.color === c ? s.colorPresetActive : ""}`}
                    style={{ background: c }}
                    onClick={() => update({ color: c })}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ── Позиция ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Позиция</div>
            <div className={s.sectionCard}>
              <div className={s.positionRow}>
                <button
                  type="button"
                  className={`${s.positionBtn} ${config.position === "bottom-left" ? s.positionBtnActive : ""}`}
                  onClick={() => update({ position: "bottom-left" })}
                >
                  ↙ Слева внизу
                </button>
                <button
                  type="button"
                  className={`${s.positionBtn} ${config.position === "bottom-right" ? s.positionBtnActive : ""}`}
                  onClick={() => update({ position: "bottom-right" })}
                >
                  ↘ Справа внизу
                </button>
              </div>
            </div>
          </div>

          {/* ── Иконка кнопки ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Иконка кнопки</div>
            <div className={s.sectionCard}>
              <div className={s.iconRow}>
                <button
                  type="button"
                  className={`${s.iconBtn} ${config.button_icon === "chat" ? s.iconBtnActive : ""}`}
                  onClick={() => update({ button_icon: "chat" })}
                  title="Чат"
                >
                  <MessageCircle style={{ width: 22, height: 22 }} />
                </button>
                <button
                  type="button"
                  className={`${s.iconBtn} ${config.button_icon === "help" ? s.iconBtnActive : ""}`}
                  onClick={() => update({ button_icon: "help" })}
                  title="Помощь"
                >
                  <HelpCircle style={{ width: 22, height: 22 }} />
                </button>
                <button
                  type="button"
                  className={`${s.iconBtn} ${config.button_icon === "custom" ? s.iconBtnActive : ""}`}
                  onClick={() => update({ button_icon: "custom" })}
                  title="Спаркл"
                >
                  <Sparkles style={{ width: 22, height: 22 }} />
                </button>
              </div>

              <div className={s.field} style={{ marginTop: 12 }}>
                <div className={s.fieldLabel}>Текст на кнопке (опционально)</div>
                <input
                  className={s.fieldInput}
                  value={config.button_text}
                  onChange={(e) => update({ button_text: e.target.value })}
                  placeholder="Например: Помощь"
                />
              </div>
            </div>
          </div>

          {/* ── Приветствие ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Приветствие</div>
            <div className={s.sectionCard}>
              <div className={s.field}>
                <div className={s.fieldLabel}>Сообщение приветствия</div>
                <textarea
                  className={s.fieldTextarea}
                  value={config.greeting}
                  onChange={(e) => update({ greeting: e.target.value })}
                  placeholder="Привет! Чем помочь?"
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* ── Оператор ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Отображение оператора</div>
            <div className={s.sectionCard}>
              <Toggle
                label="Показывать имя оператора"
                checked={config.show_operator_name}
                onChange={(v) => update({ show_operator_name: v })}
              />
              <Toggle
                label="Показывать аватар оператора"
                checked={config.show_operator_avatar}
                onChange={(v) => update({ show_operator_avatar: v })}
              />
            </div>
          </div>

          {/* ── Поведение ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Поведение</div>
            <div className={s.sectionCard}>
              <div className={s.field}>
                <div className={s.fieldLabel}>Авто-открытие (секунд, 0 = выкл)</div>
                <div className={s.numberRow}>
                  <input
                    type="number"
                    className={s.numberInput}
                    value={config.auto_open_delay}
                    onChange={(e) => update({ auto_open_delay: Math.max(0, Number(e.target.value)) })}
                    min={0}
                    max={300}
                  />
                  <span className={s.numberUnit}>сек</span>
                </div>
              </div>
              <Toggle
                label="Скрыть на мобильных устройствах"
                checked={config.hide_on_mobile}
                onChange={(v) => update({ hide_on_mobile: v })}
              />
            </div>
          </div>

          {/* ── Custom CSS ── */}
          <div className={s.section}>
            <div className={s.sectionTitle}>Кастомный CSS</div>
            <div className={s.sectionCard}>
              <div className={s.cssWarning}>
                <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
                Неправильный CSS может сломать виджет
              </div>
              <textarea
                className={s.fieldTextarea}
                value={config.custom_css}
                onChange={(e) => update({ custom_css: e.target.value })}
                placeholder=".widget-button { border-radius: 8px; }"
                rows={4}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </div>
          </div>

          {/* ── Save ── */}
          <button
            className={`${s.saveBtn} ${saved ? s.saveBtnSaved : ""}`}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            <Save style={{ width: 14, height: 14 }} />
            {saved ? "Сохранено ✓" : saving ? "Сохранение..." : "Сохранить настройки"}
          </button>

          {/* ── Embed code ── */}
          <div className={s.embedSection}>
            <div className={s.sectionTitle}>Код для сайта</div>
            <div className={s.embedCode}>
              {getWidgetEmbedCode(API_BASE)}
              <button
                type="button"
                className={s.embedCopyBtn}
                onClick={() => void handleCopyEmbed()}
              >
                {copied ? (
                  <><Check style={{ width: 12, height: 12 }} /> Скопировано</>
                ) : (
                  <><Copy style={{ width: 12, height: 12 }} /> Копировать</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ══════ Right: Live Preview ══════ */}
        <div className={s.preview}>
          <div className={s.previewTitle}>Предпросмотр</div>

          <div className={s.previewSite}>
            {/* Browser bar mock */}
            <div className={s.previewSiteBar}>
              <div className={s.previewDot} style={{ background: "#ef4444" }} />
              <div className={s.previewDot} style={{ background: "#eab308" }} />
              <div className={s.previewDot} style={{ background: "#22c55e" }} />
            </div>

            {/* Chat window */}
            <div
              className={s.previewChat}
              style={{
                [posRight ? "right" : "left"]: 16,
                bottom: 80,
              }}
            >
              <div className={s.previewChatHeader} style={{ background: config.color }}>
                {config.show_operator_name ? "Оператор" : "Чат поддержки"}
              </div>
              <div className={s.previewChatBody}>
                <div
                  className={s.previewBubble}
                  style={{ background: `${config.color}18`, color: config.color }}
                >
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