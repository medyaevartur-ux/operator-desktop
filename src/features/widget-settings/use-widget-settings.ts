import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui";
import { saveJsonFile } from "@/lib/tauri-bridge";
import {
  getWidgetConfig, saveWidgetConfig, getPrechatFormConfig, savePrechatFormConfig, getBusinessHours, saveBusinessHours,
  getDomainSettings, saveDomainSettings, getABStats, getOfflineLeads, uploadWidgetAvatar,
  DEFAULT_WIDGET_CONFIG, DEFAULT_BUSINESS_HOURS, DEFAULT_DOMAINS,
  type WidgetConfig, type PrechatField, type PrechatFormConfig, type BusinessHours, type DomainSettings, type ABStats, type OfflineLead,
} from "@/features/settings/settings.api";
import { FIELD_LABELS, type StylePreset } from "./presets";

export interface WidgetDraft { config: WidgetConfig; prechat: PrechatFormConfig; hours: BusinessHours; domains: DomainSettings }
type Updater<T> = (value: T) => T;

// Несохранённое переживает уход с экрана в пределах сеанса: вернулись — правки на месте.
let unsaved: WidgetDraft | null = null;

const withDefaults = (config: Partial<WidgetConfig>): WidgetConfig => ({
  ...DEFAULT_WIDGET_CONFIG, ...config,
  triggers: { ...DEFAULT_WIDGET_CONFIG.triggers, ...config.triggers },
  ab_variants: { ...DEFAULT_WIDGET_CONFIG.ab_variants, ...config.ab_variants },
});
const TIME = /^\d{2}:\d{2}$/;

const kind = (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
/** Из файла берём только знакомые поля того же типа: старый или правленый вручную файл не сломает экран. */
export function sameKind<T extends object>(base: T, incoming: unknown): Partial<T> {
  if (kind(incoming) !== "object") return {};
  return Object.fromEntries(Object.entries(incoming as object).filter(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(base, key)) return false;
    const expected = kind(base[key as keyof T]);
    return kind(value) === expected || (expected === "null" && typeof value === "string");
  })) as Partial<T>;
}

/** «https://www.Site.ru/page» → «site.ru»: так домен сравнивает виджет. */
export const hostOnly = (value: string) => value.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
/** Служебный раздел сайта всегда начинается с «/». */
export const pathOnly = (value: string) => { const v = value.trim(); return !v ? "" : v.startsWith("/") ? v : `/${v}`; };

/** Что помешает сохранению или сломает виджет — одной фразой, с разделом, где поправить. */
export function firstProblem(draft: WidgetDraft): string | null {
  const { config, prechat, hours } = draft;
  if (config.auto_invite_enabled && !config.auto_invite_message.trim()) return "Впишите текст автоматического приглашения — раздел «Автоматика».";
  if (prechat.enabled && !prechat.fields.length) return "Добавьте в форму перед чатом хотя бы одно поле или выключите форму.";
  if (prechat.enabled && prechat.fields.some(field => !field.label.trim())) return "У каждого поля формы должно быть название — раздел «Форма перед чатом».";
  if (Object.values(hours.schedule).some(day => !TIME.test(day.from) || !TIME.test(day.to))) return "Заполните время в расписании — раздел «Часы работы».";
  if (config.offline_mode === "redirect" && !/^https?:\/\/\S+$/i.test(config.offline_redirect_url.trim())) return "Укажите адрес страницы контактов, начиная с https:// — раздел «Часы работы».";
  // Пустой адрес «содержится» в любом адресе — такое правило перекрасило бы весь сайт.
  if (config.page_rules?.some(rule => rule.enabled && !rule.pattern.trim())) return "У правила для страниц не указан адрес — раздел «Поведение».";
  return null;
}

export function useWidgetSettings() {
  const [draft, setDraftState] = useState<WidgetDraft | null>(null);
  const [baseline, setBaseline] = useState<WidgetDraft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [abStats, setAbStats] = useState<ABStats[]>([]);
  const [leads, setLeads] = useState<OfflineLead[]>([]);

  useEffect(() => {
    let alive = true;
    setLoadError(false);
    Promise.all([getWidgetConfig(), getPrechatFormConfig(), getBusinessHours(), getDomainSettings()])
      .then(([config, prechat, hours, domains]) => {
        if (!alive) return;
        const loaded: WidgetDraft = {
          config: withDefaults(config),
          prechat: { enabled: !!prechat?.enabled, fields: prechat?.fields ?? [] },
          hours: { ...DEFAULT_BUSINESS_HOURS, ...hours, schedule: { ...DEFAULT_BUSINESS_HOURS.schedule, ...hours?.schedule } },
          domains: { ...DEFAULT_DOMAINS, ...domains },
        };
        setBaseline(loaded);
        setDraftState(unsaved ?? loaded);
      })
      .catch(() => { if (alive) setLoadError(true); });
    getABStats().then(stats => { if (alive) setAbStats(stats); }).catch(() => undefined);
    getOfflineLeads().then(list => { if (alive) setLeads(list); }).catch(() => undefined);
    return () => { alive = false; };
  }, [attempt]);

  const setDraft = useCallback((update: Updater<WidgetDraft>) => {
    setDraftState(current => { if (!current) return current; const next = update(current); unsaved = next; return next; });
  }, []);
  const upd = useCallback((patch: Partial<WidgetConfig>) => setDraft(d => ({ ...d, config: { ...d.config, ...patch } })), [setDraft]);
  const updTriggers = useCallback((patch: Partial<WidgetConfig["triggers"]>) =>
    setDraft(d => ({ ...d, config: { ...d.config, triggers: { ...d.config.triggers, ...patch } } })), [setDraft]);
  const setPrechat = useCallback((update: Updater<PrechatFormConfig>) => setDraft(d => ({ ...d, prechat: update(d.prechat) })), [setDraft]);
  const setHours = useCallback((update: Updater<BusinessHours>) => setDraft(d => ({ ...d, hours: update(d.hours) })), [setDraft]);
  const setDomains = useCallback((update: Updater<DomainSettings>) => setDraft(d => ({ ...d, domains: update(d.domains) })), [setDraft]);
  const applyPreset = useCallback((preset: StylePreset) => upd(preset.patch), [upd]);

  const dirty = useMemo(() => !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);

  const reset = useCallback(() => { unsaved = null; if (baseline) setDraftState(baseline); }, [baseline]);

  const save = useCallback(async () => {
    if (!draft || saving) return;
    const problem = firstProblem(draft);
    if (problem) { toast.warning("Проверьте настройки", problem); return; }
    setSaving(true);
    const domains = { ...draft.domains, domains: [...new Set(draft.domains.domains.map(hostOnly).filter(Boolean))] };
    const config = { ...draft.config, hidden_paths: draft.config.hidden_paths.map(pathOnly).filter(Boolean), quick_replies: draft.config.quick_replies.map(item => item.trim()).filter(Boolean) };
    const [widget, prechat, hours, access] = await Promise.allSettled([
      saveWidgetConfig(config), savePrechatFormConfig(draft.prechat), saveBusinessHours(draft.hours), saveDomainSettings(domains),
    ]);
    setSaving(false);
    // Сохранённые части становятся новой точкой отсчёта; несохранённые остаются правками.
    const saved: WidgetDraft = {
      config: widget.status === "fulfilled" ? withDefaults(widget.value.config) : baseline!.config,
      prechat: prechat.status === "fulfilled" ? (prechat.value.prechat ?? draft.prechat) : baseline!.prechat,
      hours: hours.status === "fulfilled" ? hours.value : baseline!.hours,
      domains: access.status === "fulfilled" ? access.value : baseline!.domains,
    };
    const next: WidgetDraft = {
      config: widget.status === "fulfilled" ? saved.config : draft.config,
      prechat: prechat.status === "fulfilled" ? saved.prechat : draft.prechat,
      hours: hours.status === "fulfilled" ? saved.hours : draft.hours,
      domains: access.status === "fulfilled" ? saved.domains : draft.domains,
    };
    setBaseline(saved);
    setDraftState(next);
    unsaved = JSON.stringify(next) === JSON.stringify(saved) ? null : next;

    const failed = [[widget, "оформление и поведение"], [prechat, "форма перед чатом"], [hours, "часы работы"], [access, "разрешённые сайты"]]
      .filter(([result]) => (result as PromiseSettledResult<unknown>).status === "rejected").map(([, name]) => name as string);
    const dropped = widget.status === "fulfilled" ? widget.value.dropped : [];
    if (failed.length) toast.error("Сохранилось не всё", `Не удалось сохранить: ${failed.join(", ")}. Правки остались — попробуйте ещё раз.`);
    else if (dropped.length) toast.warning("Почти всё сохранено", `Сервер не принял: ${dropped.map(key => FIELD_LABELS[key] ?? key).join(", ")}. Эти настройки вернулись к прежним значениям.`);
    else toast.success("Настройки сохранены", "Посетители увидят изменения при следующем открытии страницы.");
  }, [draft, baseline, saving]);

  const uploadAvatar = useCallback(async (file: File) => {
    try { upd({ avatar_url: await uploadWidgetAvatar(file) }); }
    catch { toast.error("Не удалось загрузить картинку", "Подойдёт JPG, PNG или WebP до 5 МБ."); }
  }, [upd]);

  const exportJson = useCallback(() => {
    if (!draft) return;
    void saveJsonFile(`vidzhet-zhivaya-skazka-${new Date().toISOString().slice(0, 10)}.json`, { widget_config: draft.config, prechat_form: draft.prechat, business_hours: draft.hours });
  }, [draft]);

  const importJson = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const config = sameKind(DEFAULT_WIDGET_CONFIG, parsed?.widget_config);
      if (!Object.keys(config).length) throw new Error("format");
      const form = parsed.prechat_form, hours = parsed.business_hours;
      setDraft(d => ({
        ...d,
        config: withDefaults({ ...d.config, ...config }),
        prechat: kind(form) === "object" && Array.isArray(form.fields)
          ? { enabled: form.enabled === true, fields: form.fields.filter((field: PrechatField) => kind(field) === "object" && typeof field.label === "string") }
          : d.prechat,
        hours: kind(hours) === "object"
          ? { ...d.hours, ...sameKind(DEFAULT_BUSINESS_HOURS, hours), schedule: { ...d.hours.schedule, ...sameKind(DEFAULT_BUSINESS_HOURS.schedule, hours.schedule) } }
          : d.hours,
      }));
      toast.info("Настройки загружены из файла", "Проверьте их в предпросмотре и нажмите «Сохранить».");
    } catch {
      toast.error("Файл не подошёл", "Нужен файл, сохранённый кнопкой «Экспорт».");
    }
  }, [setDraft]);

  return {
    draft, dirty, saving, loadError, abStats, leads,
    retry: () => setAttempt(value => value + 1),
    upd, updTriggers, setPrechat, setHours, setDomains, applyPreset, save, reset, uploadAvatar, exportJson, importJson,
  };
}

export type WidgetEditor = ReturnType<typeof useWidgetSettings> & { draft: WidgetDraft };
