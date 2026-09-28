import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ClipboardList, Clock, Code2, Download, Eye, Monitor, MousePointerClick, Palette, RotateCcw, SlidersHorizontal,
  Smartphone, Tablet, Upload, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { isAndroid } from "@/lib/api-config";
import { Segmented } from "./controls";
import { useWidgetSettings, type WidgetEditor } from "./use-widget-settings";
import { LookTab } from "./tab-look";
import { ButtonTab } from "./tab-button";
import { BehaviorTab } from "./tab-behavior";
import { AutoTab } from "./tab-auto";
import { FormTab } from "./tab-form";
import { HoursTab } from "./tab-hours";
import { InstallTab } from "./tab-install";
import s from "./WidgetSettings.module.css";

type TabId = "look" | "button" | "behavior" | "auto" | "form" | "hours" | "install";
type Device = "mobile" | "tablet" | "desktop";

const TABS: Array<{ id: TabId; label: string; icon: typeof Palette; render: (w: WidgetEditor) => ReactNode }> = [
  { id: "look", label: "Оформление", icon: Palette, render: w => <LookTab w={w} /> },
  { id: "button", label: "Кнопка и окно", icon: MousePointerClick, render: w => <ButtonTab w={w} /> },
  { id: "behavior", label: "Поведение", icon: SlidersHorizontal, render: w => <BehaviorTab w={w} /> },
  { id: "auto", label: "Автоматика", icon: Wand2, render: w => <AutoTab w={w} /> },
  { id: "form", label: "Форма перед чатом", icon: ClipboardList, render: w => <FormTab w={w} /> },
  { id: "hours", label: "Часы работы", icon: Clock, render: w => <HoursTab w={w} /> },
  { id: "install", label: "Установка", icon: Code2, render: w => <InstallTab w={w} /> },
];

function Preview({ w, tab, onClose }: { w: WidgetEditor; tab: TabId; onClose?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [open, setOpen] = useState(true);
  const post = useCallback(() => {
    frame.current?.contentWindow?.postMessage({
      type: "ZS_PREVIEW_UPDATE",
      payload: { widget_config: w.draft.config, prechat_form: w.draft.prechat, business_hours: w.draft.hours },
      previewSize: device, forceOpen: open, skipPrechatPreview: tab !== "form",
    }, "*");
  }, [w.draft, device, open, tab]);
  useEffect(() => {
    const ready = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow && event.data?.type === "ZS_PREVIEW_READY") post(); };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [post]);
  useEffect(post, [post]);
  return (
    <aside className={s.preview} aria-label="Предпросмотр виджета">
      <div className={s.previewBar}>
        <strong>Предпросмотр</strong>
        {onClose && <button type="button" className={s.iconButton} aria-label="Закрыть предпросмотр" onClick={onClose}><X /></button>}
      </div>
      <div className={s.previewTools}>
        <Segmented label="Устройство" value={device} onChange={setDevice} options={[
          { value: "mobile", label: "Телефон", icon: <Smartphone aria-hidden /> },
          { value: "tablet", label: "Планшет", icon: <Tablet aria-hidden /> },
          { value: "desktop", label: "Компьютер", icon: <Monitor aria-hidden /> },
        ]} />
        <Segmented label="Состояние" value={open ? "open" : "closed"} onChange={value => setOpen(value === "open")}
          options={[{ value: "open", label: "Окно" }, { value: "closed", label: "Кнопка" }]} />
      </div>
      <div className={s.site} data-device={device}>
        <div className={s.siteBar}><i /><i /><i /><span>zhivaya-skazka.ru</span></div>
        <iframe ref={frame} src="/widget-preview.html" sandbox="allow-scripts" title="Предпросмотр виджета на вымышленных данных" />
      </div>
      <p className={s.previewNote}>Вымышленный диалог. Сайт не меняется, пока вы не сохраните.</p>
    </aside>
  );
}

export function WidgetSettingsScreen() {
  const w = useWidgetSettings();
  const [tab, setTab] = useState<TabId>("look");
  const [previewOpen, setPreviewOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const { save, dirty } = w;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "s" || event.key.toLowerCase() === "ы")) {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, dirty]);

  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [tab]);

  if (w.loadError) {
    return (
      <div className={s.state}>
        <h1>Виджет на сайте</h1>
        <p>Не удалось загрузить настройки. Пока текущие значения не получены, сохранять нельзя — иначе можно затереть рабочие настройки.</p>
        <Button onClick={w.retry} icon={<RotateCcw aria-hidden />}>Повторить</Button>
      </div>
    );
  }
  if (!w.draft) return <div className={s.state}><h1>Виджет на сайте</h1><p>Загружаем настройки…</p></div>;
  const editor = w as WidgetEditor;
  const current = TABS.find(item => item.id === tab)!;

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1>Виджет на сайте</h1>
          <p>Как чат выглядит и ведёт себя на zhivaya-skazka.ru</p>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.smallButton} onClick={() => setPreviewOpen(true)} data-narrow-only><Eye aria-hidden />Предпросмотр</button>
          <button type="button" className={s.smallButton} onClick={() => importInput.current?.click()} title="Загрузить настройки из файла" data-compact><Upload aria-hidden /><span>Импорт</span></button>
          {/* Android WebView не сохраняет файлы из страницы — кнопка там молчала бы. */}
          {!isAndroid() && <button type="button" className={s.smallButton} onClick={w.exportJson} title="Сохранить настройки в файл" data-compact><Download aria-hidden /><span>Экспорт</span></button>}
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void w.importJson(file); }} />
        </div>
      </header>

      <nav className={s.tabs} aria-label="Разделы настроек виджета">
        {TABS.map(item => (
          <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
            <item.icon aria-hidden />{item.label}
          </button>
        ))}
      </nav>

      <div className={s.body}>
        <div ref={body} className={`${s.form} scrollbar-thin`} style={{ "--art-accent": editor.draft.config.color } as CSSProperties}>
          <div className={s.formInner}>{current.render(editor)}</div>
          <div className={s.saveBar} data-dirty={dirty || undefined} role="status">
            <span>{w.saving ? "Сохраняем…" : dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}</span>
            {dirty && (
              <>
                <Button variant="ghost" size="sm" onClick={w.reset} disabled={w.saving}>Отменить</Button>
                <Button size="sm" onClick={() => void save()} loading={w.saving}>Сохранить</Button>
              </>
            )}
          </div>
        </div>
        <div className={s.previewColumn}><Preview w={editor} tab={tab} /></div>
      </div>

      {previewOpen && (
        <div className={s.previewSheet} role="dialog" aria-modal="true" aria-label="Предпросмотр виджета">
          <Preview w={editor} tab={tab} onClose={() => setPreviewOpen(false)} />
        </div>
      )}
    </div>
  );
}
