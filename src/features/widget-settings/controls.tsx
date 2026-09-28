import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Info, Plus, TriangleAlert, X } from "lucide-react";
import s from "./WidgetSettings.module.css";

export function Section({ title, description, inactive, inactiveNote, children }: {
  title: string; description?: ReactNode; inactive?: boolean; inactiveNote?: string; children: ReactNode;
}) {
  return (
    <section className={s.section} data-inactive={inactive || undefined}>
      <header className={s.sectionHead}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {inactive && inactiveNote && <p className={s.sectionOff}>{inactiveNote}</p>}
      </header>
      <div className={s.sectionBody}>{children}</div>
    </section>
  );
}

/** Подпись слева, управление справа; `stack` — управление на всю ширину под подписью. */
export function Row({ label, hint, stack, children }: { label: string; hint?: ReactNode; stack?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className={s.row} data-stack={stack || undefined}>
      <div className={s.rowText}>
        <span id={id} className={s.rowLabel}>{label}</span>
        {hint && <span className={s.rowHint}>{hint}</span>}
      </div>
      <div className={s.rowControl} role="group" aria-labelledby={id}>{children}</div>
    </div>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return <p className={s.note} data-tone={tone}><Icon aria-hidden />{children}</p>;
}

export interface Option<T> { value: T; label: string; icon?: ReactNode }

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: Option<T>[]; onChange: (value: T) => void; label?: string;
}) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}

export function ChoiceCards<T extends string>({ value, options, onChange, label, columns = 4 }: {
  value: T; options: Array<Option<T> & { hint?: string; art: ReactNode }>; onChange: (value: T) => void; label: string; columns?: number;
}) {
  // На телефоне ряды ровные: 4 карточки — 2+2, 5 — 3+2.
  const mobileColumns = options.length === 4 ? 2 : Math.min(3, options.length);
  return (
    <div className={s.choices} style={{ "--cols": columns, "--mobile-cols": mobileColumns } as CSSProperties} role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} className={s.choice} onClick={() => onChange(option.value)}>
          <span className={s.choiceArt} aria-hidden>{option.art}</span>
          <span className={s.choiceLabel}>{option.label}</span>
          {option.hint && <span className={s.choiceHint}>{option.hint}</span>}
        </button>
      ))}
    </div>
  );
}

const SIX = /^#[0-9a-f]{6}$/i;
const toSix = (hex: string) => /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map(ch => ch + ch).join("")}` : SIX.test(hex) ? hex : "#000000";

/** Цвет меняется только на корректный код: недописанное «#12» не уходит на сервер. */
export function ColorField({ value, onChange, label, swatches }: { value: string; onChange: (value: string) => void; label: string; swatches?: string[] }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const normalize = (raw: string) => (raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`).toLowerCase();
  const commit = (raw: string) => {
    const next = normalize(raw);
    if (SIX.test(next) || /^#[0-9a-f]{3}$/i.test(next)) onChange(next); else setText(value);
  };
  return (
    <div className={s.color}>
      <label className={s.colorWell} style={{ background: value }}>
        <input type="color" value={toSix(value)} onChange={event => onChange(event.target.value)} aria-label={`${label}: выбрать на палитре`} />
      </label>
      <input className={s.colorHex} value={text} maxLength={7} spellCheck={false} aria-label={`${label}: код цвета`}
        onChange={event => { setText(event.target.value); const next = normalize(event.target.value); if (SIX.test(next)) onChange(next); }}
        onBlur={event => commit(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") commit(event.currentTarget.value); }} />
      {swatches && (
        <div className={s.swatches}>
          {swatches.map(color => (
            <button key={color} type="button" style={{ background: color }} aria-label={`Цвет ${color}`}
              aria-pressed={color.toLowerCase() === value.toLowerCase()} onClick={() => onChange(color)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Число всегда в допустимых пределах: ввод вне диапазона приводится к ближайшей границе. */
export function NumberField({ value, onChange, min, max, unit, label }: {
  value: number; onChange: (value: number) => void; min: number; max: number; unit?: string; label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (raw: string) => { const n = Math.round(Number(raw.replace(",", "."))); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value; };
  return (
    <div className={s.number}>
      <input inputMode="numeric" value={text} aria-label={label}
        onChange={event => { setText(event.target.value); if (event.target.value.trim() !== "") onChange(clamp(event.target.value)); }}
        onBlur={() => setText(String(clamp(text)))}
        onKeyDown={event => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next = Math.min(max, Math.max(min, value + (event.key === "ArrowUp" ? 1 : -1)));
            onChange(next);
          }
        }} />
      {unit && <span>{unit}</span>}
    </div>
  );
}

export function TextField({ value, onChange, label, placeholder, maxLength, multiline, rows = 3, invalid }: {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; maxLength?: number; multiline?: boolean; rows?: number; invalid?: boolean;
}) {
  const shared = { value, placeholder, maxLength, "aria-label": label, "aria-invalid": invalid || undefined };
  const near = maxLength && value.length > maxLength * 0.8;
  return (
    <div className={s.text}>
      {multiline
        ? <textarea {...shared} rows={rows} onChange={event => onChange(event.target.value)} />
        : <input {...shared} onChange={event => onChange(event.target.value)} />}
      {near && <span className={s.counter}>{value.length}/{maxLength}</span>}
    </div>
  );
}

/** Список строк: быстрые вопросы, разделы сайта, домены. */
export function ListEditor({ items, onChange, label, placeholder, addLabel, max, maxLength = 200, normalize }: {
  items: string[]; onChange: (items: string[]) => void; label: string; placeholder?: string; addLabel: string; max: number; maxLength?: number; normalize?: (value: string) => string;
}) {
  const set = (index: number, value: string) => onChange(items.map((item, i) => (i === index ? value : item)));
  return (
    <div className={s.list}>
      {items.map((item, index) => (
        <div key={index} className={s.listRow}>
          <input value={item} placeholder={placeholder} maxLength={maxLength} aria-label={`${label} ${index + 1}`}
            onChange={event => set(index, event.target.value)}
            onBlur={event => normalize && set(index, normalize(event.target.value))} />
          <button type="button" className={s.iconButton} aria-label={`Убрать: ${item || "пустая строка"}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><X /></button>
        </div>
      ))}
      {items.length < max && <button type="button" className={s.addButton} onClick={() => onChange([...items, ""])}><Plus aria-hidden />{addLabel}</button>}
    </div>
  );
}
