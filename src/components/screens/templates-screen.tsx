import { useMemo, useState } from "react";
import { ScrollText, Plus, Pencil, Trash2, Hash, Search, X } from "lucide-react";
import {
  useTemplatesStore,
  DEFAULT_TEMPLATE_CATEGORY,
  type QuickTemplate,
} from "@/store/templates.store";
import s from "./TemplatesScreen.module.css";

export function TemplatesScreen() {
  const templates = useTemplatesStore((st) => st.templates);
  const add = useTemplatesStore((st) => st.add);
  const update = useTemplatesStore((st) => st.update);
  const remove = useTemplatesStore((st) => st.remove);

  const [editing, setEditing] = useState<QuickTemplate | null>(null);
  const [isAddOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Производный список категорий из текущих шаблонов.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) set.add(t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [templates]);

  // Фильтрация по строке поиска (title/shortcut/body) + выбранной категории.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      const cat = t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY;
      if (activeCategory && cat !== activeCategory) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.shortcut.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q)
      );
    });
  }, [templates, query, activeCategory]);

  // Группировка карточек по категориям, сортировка по uses внутри категории.
  const grouped = useMemo(() => {
    const map = new Map<string, QuickTemplate[]>();
    for (const t of filtered) {
      const cat = t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY;
      const arr = map.get(cat) ?? [];
      arr.push(t);
      map.set(cat, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([cat, list]) => [cat, [...list].sort((a, b) => b.uses - a.uses)] as const);
  }, [filtered]);

  const existingShortcuts = useMemo(
    () => templates.map((t) => ({ id: t.id, shortcut: t.shortcut.toLowerCase() })),
    [templates],
  );

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.icon}><ScrollText style={{ width: 22, height: 22 }} /></div>
        <div>
          <h2 className={s.title}>Шаблоны ответов</h2>
          <div className={s.subtitle}>Быстрые ответы с переменными {"{{name}}"}, {"{{operator}}"}, {"{{date}}"}</div>
        </div>
        <button type="button" className={s.addBtn} onClick={() => setAddOpen(true)}>
          <Plus style={{ width: 16, height: 16 }} /> Новый шаблон
        </button>
      </div>

      {/* ── Поиск ── */}
      <div className={s.toolbarRow}>
        <div className={s.searchBox}>
          <Search style={{ width: 16, height: 16 }} className={s.searchIcon} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию, шорткату, тексту…"
          />
          {query && (
            <button type="button" className={s.searchClear} onClick={() => setQuery("")} title="Очистить">
              <X style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Чипы категорий ── */}
      {categories.length > 0 && (
        <div className={s.chips}>
          <button
            type="button"
            className={`${s.chip} ${activeCategory === null ? s.chipActive : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            Все
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`${s.chip} ${activeCategory === cat ? s.chipActive : ""}`}
              onClick={() => setActiveCategory((c) => (c === cat ? null : cat))}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className={s.scroll}>
        {grouped.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIcon}>
              <ScrollText style={{ width: 26, height: 26 }} />
            </div>
            <div className={s.emptyTitle}>
              {query || activeCategory ? "Ничего не найдено" : "Шаблонов пока нет"}
            </div>
            <div className={s.emptyDesc}>
              {query || activeCategory
                ? "Измените запрос или категорию"
                : "Нажмите «Новый шаблон», чтобы создать первый"}
            </div>
          </div>
        )}

        {grouped.map(([cat, list]) => (
          <section key={cat} className={s.group}>
            <div className={s.groupHead}>
              <span className={s.groupTitle}>{cat}</span>
              <span className={s.groupCount}>{list.length}</span>
            </div>
            <div className={s.grid}>
              {list.map((t) => (
                <div key={t.id} className={s.card}>
                  <div className={s.cardHead}>
                    <div>
                      <div className={s.cardTitle}>{t.title}</div>
                      {t.shortcut && (
                        <div className={s.cardShortcut}><Hash style={{ width: 11, height: 11, marginRight: 2 }} />{t.shortcut.replace(/^\//, "")}</div>
                      )}
                    </div>
                    <div className={s.cardActions}>
                      <button type="button" onClick={() => setEditing(t)} title="Редактировать">
                        <Pencil style={{ width: 15, height: 15 }} />
                      </button>
                      <button type="button" onClick={() => { if (confirm("Удалить шаблон?")) remove(t.id); }} title="Удалить">
                        <Trash2 style={{ width: 15, height: 15 }} />
                      </button>
                    </div>
                  </div>
                  <div className={s.cardBody}>{t.body}</div>
                  <div className={s.cardFooter}>
                    <span>Использован: {t.uses}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {(isAddOpen || editing) && (
        <TemplateModal
          initial={editing}
          categories={categories}
          existingShortcuts={existingShortcuts}
          onClose={() => { setEditing(null); setAddOpen(false); }}
          onSave={(data) => {
            if (editing) update(editing.id, data);
            else add(data);
            setEditing(null);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  initial, categories, existingShortcuts, onClose, onSave,
}: {
  initial: QuickTemplate | null;
  categories: string[];
  existingShortcuts: { id: string; shortcut: string }[];
  onClose: () => void;
  onSave: (data: { title: string; shortcut: string; body: string; category: string }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState(initial?.category ?? DEFAULT_TEMPLATE_CATEGORY);

  // ── Валидация shortcut: ведущий «/», без пробелов, уникальность ──
  const shortcutError = useMemo(() => {
    const raw = shortcut.trim();
    if (!raw) return null; // shortcut необязателен
    if (!raw.startsWith("/")) return "Шорткат должен начинаться с «/»";
    if (/\s/.test(raw)) return "Шорткат не должен содержать пробелов";
    if (raw === "/") return "Укажите команду после «/»";
    const lower = raw.toLowerCase();
    const clash = existingShortcuts.some(
      (x) => x.shortcut === lower && x.id !== (initial?.id ?? ""),
    );
    if (clash) return "Такой шорткат уже используется";
    return null;
  }, [shortcut, existingShortcuts, initial]);

  const canSave =
    title.trim().length > 0 && body.trim().length > 0 && !shortcutError;

  return (
    <>
      <div className={s.modalOverlay} onClick={onClose} />
      <div className={s.modal} role="dialog" aria-modal="true">
        <div className={s.modalTitle}>{initial ? "Редактировать шаблон" : "Новый шаблон"}</div>

        <div className={s.field}>
          <label>Название</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Приветствие" />
        </div>

        <div className={s.field}>
          <label>Категория</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={DEFAULT_TEMPLATE_CATEGORY}
            list="template-categories"
          />
          <datalist id="template-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className={s.hint}>Группирует шаблоны на этом экране</div>
        </div>

        <div className={s.field}>
          <label>Шорткат (необязательно)</label>
          <input
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="/привет"
            className={shortcutError ? s.inputError : undefined}
            aria-invalid={!!shortcutError}
          />
          {shortcutError
            ? <div className={s.errorHint}>{shortcutError}</div>
            : <div className={s.hint}>Ведущий «/», без пробелов. Для быстрой вставки в composer'е.</div>}
        </div>

        <div className={s.field}>
          <label>Текст ответа</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Здравствуйте, {{name}}! Чем могу помочь?"
          />
          <div className={s.hint}>Доступны переменные: {"{{name}}"}, {"{{operator}}"}, {"{{date}}"}</div>
        </div>

        <div className={s.modalActions}>
          <button type="button" className={s.btnGhost} onClick={onClose}>Отмена</button>
          <button
            type="button"
            className={s.btnPrimary}
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "default" }}
            onClick={() => canSave && onSave({
              title: title.trim(),
              shortcut: shortcut.trim(),
              body: body.trim(),
              category: category.trim() || DEFAULT_TEMPLATE_CATEGORY,
            })}
          >
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </>
  );
}
