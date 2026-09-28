import { useRef } from "react";
import { ArrowRight, ImageUp, Trash2, Palette } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { Toggle } from "@/components/ui";
import type { WidgetConfig } from "@/features/settings/settings.api";
import { ChoiceCards, ColorField, Note, NumberField, Row, Section, Segmented, TextField } from "./controls";
import { PresetArt, ThemeArt } from "./art";
import { COLOR_SWATCHES, FONTS, STYLE_PRESETS, fillOf } from "./presets";
import type { WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

const CUSTOM_COLORS: Array<[keyof WidgetConfig, string]> = [
  ["custom_bg", "Фон окна"], ["custom_text", "Текст"], ["custom_bubble_bg", "Фон сообщений"], ["custom_border", "Рамки"],
];

export function LookTab({ w }: { w: WidgetEditor }) {
  const c = w.draft.config;
  const avatarInput = useRef<HTMLInputElement>(null);
  const gradient = c.gradient_type === "gradient" || c.gradient_type === "animated";
  return (
    <>
      <Section title="Готовый стиль" description="Основа для оформления: меняет цвета, формы и шрифт. Тексты и правила остаются как были.">
        <div className={s.presets}>
          {STYLE_PRESETS.map(preset => {
            const active = c.color.toLowerCase() === String(preset.patch.color).toLowerCase() && c.gradient_type === preset.patch.gradient_type && c.theme === preset.patch.theme;
            return (
              <button key={preset.id} type="button" className={s.preset} aria-pressed={active} onClick={() => w.applyPreset(preset)}>
                <PresetArt look={preset.look} />
                <strong>{preset.name}</strong>
                <span>{preset.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Цвет" description="Кнопка, шапка окна и ваши сообщения.">
        <Row label="Основной цвет" stack>
          <ColorField label="Основной цвет" value={c.color} swatches={COLOR_SWATCHES}
            onChange={color => w.upd(c.gradient_type === "solid" ? { color } : { color, gradient_from: color })} />
        </Row>
        <Row label="Заливка" hint="Как закрашены кнопка и шапка">
          <Segmented label="Заливка" value={c.gradient_type} onChange={gradient_type => w.upd({ gradient_type })}
            options={[{ value: "solid", label: "Цвет" }, { value: "gradient", label: "Градиент" }, { value: "animated", label: "Перелив" }, { value: "glass", label: "Стекло" }]} />
        </Row>
        {gradient && (
          <Row label="Переход цвета" stack>
            <div className={s.gradient}>
              <ColorField label="Начало" value={c.gradient_from} onChange={gradient_from => w.upd({ gradient_from })} />
              <ArrowRight className={s.gradientArrow} aria-hidden />
              <ColorField label="Конец" value={c.gradient_to} onChange={gradient_to => w.upd({ gradient_to })} />
              {c.gradient_type === "gradient" && (
                <div className={s.angle}>
                  <span>Угол</span>
                  <NumberField label="Угол градиента" value={c.gradient_angle} min={0} max={360} unit="°" onChange={gradient_angle => w.upd({ gradient_angle })} />
                </div>
              )}
            </div>
            <div className={s.fillStrip} data-animated={c.gradient_type === "animated" || undefined} style={{ background: fillOf(c) }} />
          </Row>
        )}
        <Row label="Шапка окна" hint="Светлая спокойнее, цветная заметнее">
          <Segmented label="Шапка окна" value={c.header_style ?? "light"} onChange={header_style => w.upd({ header_style })}
            options={[{ value: "light", label: "Светлая" }, { value: "accent", label: "Цветная" }]} />
        </Row>
      </Section>

      <Section title="Тема окна">
        <ChoiceCards label="Тема окна" value={c.theme} onChange={theme => w.upd({ theme })} options={[
          { value: "light", label: "Светлая", art: <ThemeArt theme="light" /> },
          { value: "dark", label: "Тёмная", art: <ThemeArt theme="dark" /> },
          { value: "auto", label: "Как у посетителя", hint: "По настройке устройства", art: <ThemeArt theme="auto" /> },
          { value: "custom", label: "Свои цвета", art: <ThemeArt theme="custom" /> },
        ]} />
        {c.theme === "custom" && (
          <div className={s.grid2}>
            {CUSTOM_COLORS.map(([key, label]) => (
              <Row key={key} label={label} stack>
                <ColorField label={label} value={String(c[key] || "#ffffff")} onChange={value => w.upd({ [key]: value } as Partial<WidgetConfig>)} />
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section title="Шрифт">
        <div className={s.fonts} role="radiogroup" aria-label="Шрифт">
          {FONTS.map(font => (
            <button key={font.value} type="button" role="radio" aria-checked={c.font_family === font.value} onClick={() => w.upd({ font_family: font.value })}>
              <span style={{ fontFamily: font.css }}>Аа</span>{font.label}
            </button>
          ))}
        </div>
        {c.font_family === "custom" && (
          <Row label="Ссылка на шрифт" hint="Из Google Fonts, например family=Nunito" stack>
            <TextField label="Ссылка на шрифт" value={c.custom_font_url} maxLength={500} placeholder="https://fonts.googleapis.com/css2?family=Nunito" onChange={custom_font_url => w.upd({ custom_font_url })} />
          </Row>
        )}
        <Row label="Размер текста">
          <Segmented label="Размер текста" value={c.font_size_base} onChange={font_size_base => w.upd({ font_size_base })}
            options={[13, 14, 15, 16].map(size => ({ value: size, label: `${size}` }))} />
        </Row>
      </Section>

      <Section title="Шапка окна" description="Кого посетитель видит вверху окна чата.">
        <Row label="Заголовок">
          <TextField label="Заголовок" value={c.header_title} maxLength={60} placeholder="Живая Сказка" onChange={header_title => w.upd({ header_title })} />
        </Row>
        <Row label="Аватар" hint="Круглая картинка рядом с заголовком">
          <div className={s.avatar}>
            <span className={s.avatarImage}>{c.avatar_url ? <img src={new URL(c.avatar_url, API_BASE).href} alt="" /> : (c.header_title.trim()[0] ?? "Ж")}</span>
            <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void w.uploadAvatar(file); }} />
            <button type="button" className={s.smallButton} onClick={() => avatarInput.current?.click()}><ImageUp aria-hidden />Загрузить</button>
            {c.avatar_url && <button type="button" className={s.smallButton} data-tone="danger" onClick={() => w.upd({ avatar_url: null })}><Trash2 aria-hidden />Убрать</button>}
          </div>
        </Row>
        <Toggle label="Имя оператора" description="Показывать, кто отвечает" checked={c.show_operator_name} onChange={show_operator_name => w.upd({ show_operator_name })} />
        <Toggle label="Фото оператора" checked={c.show_operator_avatar} onChange={show_operator_avatar => w.upd({ show_operator_avatar })} />
        <Toggle label="Команда в шапке" description="Аватары тех, кто сейчас в сети, вместо заголовка" checked={c.team_mode} onChange={team_mode => w.upd({ team_mode })} />
        {c.team_mode && (
          <div className={s.nested}>
            <Row label="Название команды"><TextField label="Название команды" value={c.team_label} maxLength={60} onChange={team_label => w.upd({ team_label })} /></Row>
            <Row label="Строка «в сети»" hint="{n} заменится числом"><TextField label="Строка «в сети»" value={c.team_online_text} maxLength={60} onChange={team_online_text => w.upd({ team_online_text })} /></Row>
            <Row label="Аватаров в шапке"><NumberField label="Аватаров в шапке" value={c.team_avatars_count} min={1} max={10} onChange={team_avatars_count => w.upd({ team_avatars_count })} /></Row>
          </div>
        )}
        <Toggle label="Время ответа" description="Строка под заголовком" checked={c.response_time_enabled} onChange={response_time_enabled => w.upd({ response_time_enabled })} />
        {c.response_time_enabled && (
          <div className={s.nested}>
            <Row label="Текст"><TextField label="Время ответа" value={c.response_time_label} maxLength={80} placeholder="Обычно отвечаем за 2 мин" onChange={response_time_label => w.upd({ response_time_label })} /></Row>
          </div>
        )}
      </Section>

      <details className={s.advanced}>
        <summary><Palette aria-hidden />Для разработчиков: свой CSS</summary>
        <Note tone="warn">Ошибка в CSS может спрятать или сломать виджет на сайте. Проверьте результат в предпросмотре.</Note>
        <textarea className={s.code} aria-label="Свой CSS виджета" spellCheck={false} maxLength={10000} value={c.custom_css || ""} onChange={event => w.upd({ custom_css: event.target.value })} />
      </details>
    </>
  );
}
