import { useEffect, useMemo, useState } from "react";
import { Zap, Plus, Search, Pencil, Trash2, Download, RefreshCw } from "lucide-react";
import { useTemplatesStore, legacyTemplates, type QuickTemplate } from "@/store/templates.store";
import { Button, Input, Modal, toast, useConfirm } from "@/components/ui";
import s from "./TemplatesScreen.module.css";
const empty = { title: "", shortcut: "/", body: "", category: "Общие" };
export function TemplatesScreen() {
  const store = useTemplatesStore();
  const [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const [open, setOpen] = useState(false), [editing, setEditing] = useState<QuickTemplate | null>(null);
  const [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { confirm } = useConfirm();
  useEffect(() => { void store.load(); }, []);
  const categories = store.categories();
  const list = useMemo(() => store.templates.filter(item => (!category || item.category === category) && [item.title, item.body, item.shortcut].some(value => value.toLowerCase().includes(query.toLowerCase()))), [store.templates, category, query]);
  const legacy = legacyTemplates().length;
  const edit = (item: QuickTemplate | null) => { setEditing(item); setForm(item ? { title: item.title, shortcut: item.shortcut, body: item.body, category: item.category } : empty); setError(""); setOpen(true); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (editing) await store.update(editing.id, { ...form, revision: editing.revision }); else await store.add(form);
      setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить шаблон"); }
    finally { setBusy(false); }
  };
  return <div className={s.page}>
    <header className={s.header}><div><h1>Быстрые ответы</h1><p>Общие фразы команды. В ответе клиенту наберите «/» и начните писать название.</p></div><Button onClick={() => edit(null)}><Plus size={16} />Новый ответ</Button></header>
    <div className={s.toolbar}><div className={s.search}><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти ответ или команду" aria-label="Поиск шаблонов" /></div><button className={s.refresh} aria-label="Обновить шаблоны" onClick={() => void store.load()}><RefreshCw size={17} /></button>{legacy > 0 && <Button variant="secondary" size="sm" onClick={() => void store.importLegacy().then(result => toast.success(`Добавлено: ${result.imported.length}. Конфликтов: ${result.conflicts.length}.`)).catch(error => toast.error(error.message))}><Download size={15} />Перенести прежние ({legacy})</Button>}</div>
    <nav className={s.categories} aria-label="Категории ответов"><button aria-pressed={!category} onClick={() => setCategory("")}>Все ответы <span>{store.templates.length}</span></button>{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</nav>
    {store.error && <div className={s.error} role="alert">{store.error}<button onClick={() => void store.load()}>Повторить</button></div>}
    <div className={s.list}>{list.map(item => <article className={s.card} key={item.id}><div className={s.cardHead}><div><span className={s.category}>{item.category}</span><h2>{item.title}</h2></div><code>{item.shortcut}</code></div><p>{item.body}</p><footer><span>Использован {item.uses} раз</span><button aria-label={`Изменить ${item.title}`} onClick={() => edit(item)}><Pencil size={16} /></button><button aria-label={`Удалить ${item.title}`} onClick={() => void confirm({ title: "Удалить общий ответ?", message: "Он исчезнет из библиотеки всей команды.", confirmText: "Удалить", danger: true }).then(ok => ok ? store.remove(item.id) : undefined).catch(error => toast.error(error.message))}><Trash2 size={16} /></button></footer></article>)}{!list.length && <div className={s.empty}><Zap size={32} /><h2>{store.loading ? "Загружаем ответы…" : query || category ? "Ответов не найдено" : "Начните с частых вопросов"}</h2><p>{query || category ? "Попробуйте другую фразу или категорию." : "Создайте приветствие, ответ о доставке или помощь с выбором книги."}</p></div>}</div>
    <aside className={s.tip}><code>/команда</code><p>Напишите команду в поле сообщения. Переменные <b>{"{{name}}"}</b>, <b>{"{{operator}}"}</b> и <b>{"{{date}}"}</b> подставятся автоматически.</p></aside>
    <Modal open={open} onClose={() => !busy && setOpen(false)} title={editing ? "Редактировать быстрый ответ" : "Новый быстрый ответ"} width={600} footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Отмена</Button><Button onClick={() => void save()} disabled={busy || !form.title.trim() || !form.body.trim() || form.shortcut.length < 2}>{busy ? "Сохраняем…" : "Сохранить для команды"}</Button></>}><div className={s.form}><Input label="Название" value={form.title} maxLength={120} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Например, помощь с выбором" /><div className={s.formRow}><Input label="Команда" value={form.shortcut} maxLength={50} onChange={e => setForm({ ...form, shortcut: e.target.value.replace(/\s/g, "") })} placeholder="/выбор" /><Input label="Категория" value={form.category} maxLength={80} onChange={e => setForm({ ...form, category: e.target.value })} /></div><label>Текст ответа<textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} maxLength={10000} placeholder="Здравствуйте, {{name}}!" /></label><small>Ответ синхронизируется между Windows, Android и браузером.</small>{error && <p className={s.error} role="alert">{error}</p>}</div></Modal>
  </div>;
}
