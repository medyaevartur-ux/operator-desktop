import { HelpCircle, MessageCircle, Sparkles } from "lucide-react";
import { Toggle } from "@/components/ui";
import type { WidgetConfig } from "@/features/settings/settings.api";
import { ChoiceCards, Row, Section, Segmented, TextField } from "./controls";
import { InheritArt, LauncherArt, MobileModeArt, ShapeIcon, SideIcon } from "./art";
import type { WidgetEditor } from "./use-widget-settings";

const LAUNCHERS: Array<{ value: WidgetConfig["launcher_type"]; label: string }> = [
  { value: "icon_only", label: "Круглая кнопка" }, { value: "icon_text", label: "Кнопка с текстом" },
  { value: "text_only", label: "Только текст" }, { value: "card", label: "Карточка" },
];

export function ButtonTab({ w }: { w: WidgetEditor }) {
  const c = w.draft.config;
  const mobileLauncher = (c.mobile_launcher_type || "inherit") as WidgetConfig["mobile_launcher_type"];
  return (
    <>
      <Section title="Кнопка на сайте" description="Её посетитель видит на каждой странице.">
        <ChoiceCards label="Вид кнопки" value={c.launcher_type} onChange={launcher_type => w.upd({ launcher_type })}
          options={LAUNCHERS.map(item => ({ ...item, art: <LauncherArt type={item.value} /> }))} />
        {c.launcher_type !== "icon_only" && (
          <Row label="Текст на кнопке">
            <TextField label="Текст на кнопке" value={c.launcher_text} maxLength={40} placeholder="Нужна помощь?" onChange={launcher_text => w.upd({ launcher_text })} />
          </Row>
        )}
        {c.launcher_type === "card" && (
          <>
            <Row label="Подпись в карточке">
              <TextField label="Подпись в карточке" value={c.launcher_subtext} maxLength={60} placeholder="Обычно отвечаем за 2 мин" onChange={launcher_subtext => w.upd({ launcher_subtext })} />
            </Row>
            <Toggle label="Фото в карточке" checked={c.launcher_show_avatar} onChange={launcher_show_avatar => w.upd({ launcher_show_avatar })} />
          </>
        )}
        <Row label="Значок">
          <Segmented label="Значок" value={c.button_icon} onChange={button_icon => w.upd({ button_icon })} options={[
            { value: "chat", label: "Сообщение", icon: <MessageCircle aria-hidden /> },
            { value: "help", label: "Вопрос", icon: <HelpCircle aria-hidden /> },
            { value: "custom", label: "Искра", icon: <Sparkles aria-hidden /> },
          ]} />
        </Row>
        <Row label="Размер">
          <Segmented label="Размер кнопки" value={c.button_size} onChange={button_size => w.upd({ button_size })}
            options={[{ value: "small", label: "Маленькая" }, { value: "medium", label: "Средняя" }, { value: "large", label: "Большая" }]} />
        </Row>
        <Row label="Форма">
          <Segmented label="Форма кнопки" value={c.button_radius} onChange={button_radius => w.upd({ button_radius })} options={[
            { value: "round", label: "Круг", icon: <ShapeIcon radius="round" /> },
            { value: "rounded", label: "Скруглённая", icon: <ShapeIcon radius="rounded" /> },
            { value: "square", label: "Квадрат", icon: <ShapeIcon radius="square" /> },
          ]} />
        </Row>
        <Row label="Сторона экрана">
          <Segmented label="Сторона экрана" value={c.position} onChange={position => w.upd({ position })} options={[
            { value: "bottom-left", label: "Слева", icon: <SideIcon side="bottom-left" /> },
            { value: "bottom-right", label: "Справа", icon: <SideIcon side="bottom-right" /> },
          ]} />
        </Row>
        <Row label="Отступ от края">
          <Segmented label="Отступ от края" value={c.edge_margin} onChange={edge_margin => w.upd({ edge_margin })}
            options={[16, 24, 32, 40].map(value => ({ value, label: `${value} px` }))} />
        </Row>
        <Toggle label="Пульсация" description="Мягкая волна вокруг кнопки притягивает взгляд" checked={c.launcher_pulse} onChange={launcher_pulse => w.upd({ launcher_pulse })} />
      </Section>

      <Section title="Окно чата">
        <Row label="Ширина">
          <Segmented label="Ширина окна" value={c.window_width} onChange={window_width => w.upd({ window_width })}
            options={[{ value: "narrow", label: "Узкое" }, { value: "normal", label: "Обычное" }, { value: "wide", label: "Широкое" }]} />
        </Row>
        <Row label="Скругление сообщений">
          <Segmented label="Скругление сообщений" value={c.bubble_radius} onChange={bubble_radius => w.upd({ bubble_radius })}
            options={[{ value: "sharp", label: "Строгое" }, { value: "soft", label: "Мягкое" }, { value: "round", label: "Круглое" }]} />
        </Row>
        <Row label="Тень">
          <Segmented label="Тень окна и кнопки" value={c.shadow_intensity} onChange={shadow_intensity => w.upd({ shadow_intensity })}
            options={[{ value: "subtle", label: "Лёгкая" }, { value: "medium", label: "Средняя" }, { value: "strong", label: "Глубокая" }]} />
        </Row>
        <Row label="Как появляется">
          <Segmented label="Как появляется окно" value={c.open_animation} onChange={open_animation => w.upd({ open_animation })} options={[
            { value: "slide", label: "Выезжает" }, { value: "pop", label: "Всплывает" }, { value: "fade", label: "Проявляется" },
            { value: "bounce", label: "Пружинит" }, { value: "flip", label: "Поворачивается" },
          ]} />
        </Row>
        <Toggle label="Подпись «Живая Сказка» внизу окна" checked={c.show_powered_by !== false} onChange={show_powered_by => w.upd({ show_powered_by })} />
      </Section>

      <Section title="На телефоне" description="Экран маленький, поэтому кнопка и окно настраиваются отдельно.">
        <Row label="Кнопка" stack>
          <ChoiceCards label="Кнопка на телефоне" columns={5} value={mobileLauncher} onChange={mobile_launcher_type => w.upd({ mobile_launcher_type })} options={[
            { value: "inherit", label: "Как на компьютере", art: <InheritArt /> },
            ...LAUNCHERS.map(item => ({ ...item, art: <LauncherArt type={item.value} /> })),
          ]} />
        </Row>
        <Row label="Окно чата" stack>
          <ChoiceCards label="Окно на телефоне" columns={3} value={c.mobile_window_mode} onChange={mobile_window_mode => w.upd({ mobile_window_mode })} options={[
            { value: "fullscreen", label: "Весь экран", hint: "Удобно писать длинные сообщения", art: <MobileModeArt mode="fullscreen" /> },
            { value: "bottom_sheet", label: "Шторка снизу", hint: "Сайт остаётся виден сверху", art: <MobileModeArt mode="bottom_sheet" /> },
            { value: "popup", label: "Окно по центру", hint: "Компактно, как на компьютере", art: <MobileModeArt mode="popup" /> },
          ]} />
        </Row>
        <Toggle label="Без счётчика непрочитанных на телефоне" checked={c.mobile_hide_unread_badge === true} onChange={mobile_hide_unread_badge => w.upd({ mobile_hide_unread_badge })} />
      </Section>
    </>
  );
}
