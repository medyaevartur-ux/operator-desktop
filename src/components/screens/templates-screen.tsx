import { useState } from "react";
import { ScrollText, Plus, Pencil, Trash2, Hash } from "lucide-react";
import { useTemplatesStore, type QuickTemplate } from "@/store/templates.store";
import s from "./TemplatesScreen.module.css";

export function TemplatesScreen() {
  const templates = useTemplatesStore((st) => st.templates);
  const add = useTemplatesStore((st) => st.add);
  const update = useTemplatesStore((st) => st.update);
  const remove = useTemplatesStore((st) => st.remove);

  const [editing, setEditing] = useState<QuickTemplate | null>(null);
  const [isAddOpen, setAddOpen] = useState(false);

  const sorted = [...templates].sort((a, b) => b.uses - a.uses);

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

      <div className={s.grid}>
        {sorted.length === 0 && (
          <div className={s.empty}>
            <ScrollText style={{ width: 36, height: 36, opacity: 0.5 }} />
            <div>Шаблонов пока нет — нажмите «Новый шаблон»</div>
          </div>
        )}

        {sorted.map((t) => (
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

      {(isAddOpen || editing) && (
        <TemplateModal
          initial={editing}
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
  initial, onClose, onSave,
}: {
  initial: QuickTemplate | null;
  onClose: () => void;
  onSave: (data: { title: string; shortcut: string; body: string }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

  const canSave = title.trim().length > 0 && body.trim().length > 0;

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
          <label>Шорткат (необязательно)</label>
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/привет" />
          <div className={s.hint}>Используется для быстрой вставки в composer'е</div>
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
            onClick={() => canSave && onSave({ title: title.trim(), shortcut: shortcut.trim(), body: body.trim() })}
          >
            {initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </>
  );
}
