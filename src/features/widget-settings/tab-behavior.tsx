import { Plus, Trash2 } from "lucide-react";
import { Toggle } from "@/components/ui";
import type { PageRule, WidgetConfig } from "@/features/settings/settings.api";
import { ColorField, ListEditor, Note, NumberField, Row, Section, Segmented, TextField } from "./controls";
import { pathOnly, type WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

export function BehaviorTab({ w }: { w: WidgetEditor }) {
  const c = w.draft.config;
  const mode = c.display_pages_mode ?? "all";
  const rules = c.page_rules ?? [];
  const setRule = (index: number, patch: Partial<PageRule>) => w.upd({ page_rules: rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });
  const setOverride = (index: number, patch: Partial<WidgetConfig>) => {
    const override = { ...rules[index].override, ...patch };
    for (const key of Object.keys(patch) as Array<keyof WidgetConfig>) if (!patch[key]) delete override[key];
    setRule(index, { override });
  };
  return (
    <>
      <Section title="Где показывать">
        <Segmented label="Где показывать виджет" value={mode} onChange={display_pages_mode => w.upd({ display_pages_mode })} options={[
          { value: "all", label: "На всех страницах" }, { value: "include", label: "Только на выбранных" }, { value: "exclude", label: "Везде, кроме выбранных" },
        ]} />
        {mode !== "all" && (
          <Row label={mode === "include" ? "Страницы, где виджет есть" : "Страницы без виджета"} hint="Через запятую; достаточно части адреса: /catalog, /faq" stack>
            <TextField label="Список страниц" value={c.display_pages ?? ""} maxLength={5000} placeholder="/catalog, /faq" onChange={display_pages => w.upd({ display_pages })} />
          </Row>
        )}
        <Row label="Служебные разделы" hint="Здесь виджета нет никогда, даже если выше выбрано «везде»" stack>
          <ListEditor label="Служебный раздел" items={c.hidden_paths ?? []} max={50} placeholder="/admin" addLabel="Добавить раздел"
            normalize={pathOnly} onChange={hidden_paths => w.upd({ hidden_paths })} />
        </Row>
        <Toggle label="Скрыть на телефонах" checked={c.hide_on_mobile} onChange={hide_on_mobile => w.upd({ hide_on_mobile })} />
      </Section>

      <Section title="Приветствие" description="Первое, что видит посетитель, открыв чат.">
        <Row label="Текст приветствия" stack>
          <TextField label="Текст приветствия" multiline value={c.greeting} maxLength={1000} placeholder="Здравствуйте! Поможем выбрать сказку." onChange={greeting => w.upd({ greeting })} />
        </Row>
        <Toggle label="Только при первом визите" description="Вернувшийся посетитель приветствие не увидит" checked={c.greet_once === true} onChange={greet_once => w.upd({ greet_once })} />
        <Toggle label="Быстрые вопросы" description="Кнопки, которые отправляют вопрос одним касанием" checked={c.quick_replies_enabled} onChange={quick_replies_enabled => w.upd({ quick_replies_enabled })} />
        {c.quick_replies_enabled && (
          <div className={s.nested}>
            <ListEditor label="Быстрый вопрос" items={c.quick_replies ?? []} max={10} placeholder="Сколько стоит доставка?" addLabel="Добавить вопрос" onChange={quick_replies => w.upd({ quick_replies })} />
          </div>
        )}
      </Section>

      <Section title="Удобство посетителя">
        <Toggle label="Помнить открытое окно" description="Если посетитель не закрыл чат, на следующей странице он останется открытым" checked={c.remember_open_state !== false} onChange={remember_open_state => w.upd({ remember_open_state })} />
        <Row label="Свернуть без действий через" hint="0 — не сворачивать">
          <NumberField label="Свернуть без действий через" value={c.auto_minimize_after ?? 0} min={0} max={3600} unit="сек" onChange={auto_minimize_after => w.upd({ auto_minimize_after })} />
        </Row>
        <Toggle label="Без счётчика непрочитанных на кнопке" checked={c.hide_unread_badge === true} onChange={hide_unread_badge => w.upd({ hide_unread_badge })} />
        <Toggle label="Без звуков у посетителя" checked={c.disable_sound_for_visitor === true} onChange={disable_sound_for_visitor => w.upd({ disable_sound_for_visitor })} />
      </Section>

      <Section title="Правила для отдельных страниц" description="Свой цвет или приветствие, например на странице акции. Автоматические приглашения правилами не включаются.">
        {rules.map((rule, index) => (
          <div key={rule.id} className={s.item} data-off={!rule.enabled || undefined}>
            <div className={s.itemHead}>
              <Toggle label={rule.enabled ? "Правило действует" : "Правило выключено"} checked={rule.enabled} onChange={enabled => setRule(index, { enabled })} />
              <button type="button" className={s.iconButton} aria-label="Удалить правило" onClick={() => w.upd({ page_rules: rules.filter((_, i) => i !== index) })}><Trash2 /></button>
            </div>
            <Row label="Адрес страницы" stack>
              <div className={s.inline}>
                <Segmented label="Как сравнивать" value={rule.match_type} onChange={match_type => setRule(index, { match_type })}
                  options={[{ value: "contains", label: "Содержит" }, { value: "exact", label: "Точно" }, { value: "regex", label: "Шаблон" }]} />
                <TextField label="Адрес страницы" value={rule.pattern} maxLength={500} placeholder="/sale" onChange={pattern => setRule(index, { pattern })} />
              </div>
            </Row>
            <Row label="Цвет на этой странице" hint={rule.override.color ? undefined : "Как везде"} stack>
              <div className={s.inline}>
                <ColorField label="Цвет правила" value={String(rule.override.color || c.color)} onChange={color => setOverride(index, { color })} />
                {rule.override.color && <button type="button" className={s.smallButton} onClick={() => setOverride(index, { color: "" })}>Как везде</button>}
              </div>
            </Row>
            <Row label="Приветствие на этой странице" stack>
              <TextField label="Приветствие правила" value={String(rule.override.greeting ?? "")} maxLength={1000} placeholder="Пусто — обычное приветствие" onChange={greeting => setOverride(index, { greeting })} />
            </Row>
          </div>
        ))}
        {rules.length < 50 && (
          <button type="button" className={s.addButton} onClick={() => w.upd({ page_rules: [...rules, { id: `pr_${Date.now()}`, pattern: "", match_type: "contains", override: {}, enabled: true }] })}>
            <Plus aria-hidden />Добавить правило
          </button>
        )}
        {!rules.length && <Note>Правил пока нет — везде одинаковое оформление.</Note>}
      </Section>
    </>
  );
}
