import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Toggle } from "@/components/ui";
import type { PrechatField } from "@/features/settings/settings.api";
import { ListEditor, Note, Row, Section, Segmented, TextField } from "./controls";
import type { WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

const TYPES: Array<{ value: PrechatField["type"]; label: string }> = [
  { value: "text", label: "Текст" }, { value: "tel", label: "Телефон" }, { value: "email", label: "Почта" },
  { value: "textarea", label: "Абзац" }, { value: "select", label: "Выбор" },
];

export function FormTab({ w }: { w: WidgetEditor }) {
  const form = w.draft.prechat;
  const setField = (index: number, patch: Partial<PrechatField>) =>
    w.setPrechat(p => ({ ...p, fields: p.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) }));
  const move = (index: number, by: number) => w.setPrechat(p => {
    const fields = [...p.fields];
    const [field] = fields.splice(index, 1);
    fields.splice(index + by, 0, field);
    return { ...p, fields };
  });
  return (
    <>
      <Section title="Форма перед чатом" description="Спросить имя или телефон до начала переписки. Справа в предпросмотре видно, как её увидит посетитель.">
        <Toggle label="Показывать форму" description={form.enabled ? "Посетитель сначала заполняет форму, потом пишет" : "Посетитель сразу пишет в чат"}
          checked={form.enabled} onChange={enabled => w.setPrechat(p => ({ ...p, enabled, fields: enabled && !p.fields.length ? [{ name: "name", label: "Как вас зовут?", type: "text", required: true, placeholder: "Имя" }] : p.fields }))} />
      </Section>

      {form.enabled && (
        <Section title="Поля формы">
          {form.fields.map((field, index) => (
            <div key={field.name} className={s.item}>
              <div className={s.itemHead}>
                <strong className={s.itemTitle}>Поле {index + 1}</strong>
                <div className={s.itemTools}>
                  <button type="button" className={s.iconButton} aria-label="Выше" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></button>
                  <button type="button" className={s.iconButton} aria-label="Ниже" disabled={index === form.fields.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button>
                  <button type="button" className={s.iconButton} aria-label="Удалить поле" onClick={() => w.setPrechat(p => ({ ...p, fields: p.fields.filter((_, i) => i !== index) }))}><Trash2 /></button>
                </div>
              </div>
              <Row label="Вопрос" stack>
                <TextField label="Вопрос поля" value={field.label} maxLength={200} invalid={!field.label.trim()} placeholder="Как вас зовут?" onChange={label => setField(index, { label })} />
              </Row>
              <Row label="Ответ" stack>
                <Segmented label="Тип ответа" value={field.type} onChange={type => setField(index, { type, options: type === "select" ? field.options ?? ["", ""] : field.options })} options={TYPES} />
              </Row>
              {field.type === "select" ? (
                <Row label="Варианты" stack>
                  <ListEditor label="Вариант" items={field.options ?? []} max={50} placeholder="Вариант ответа" addLabel="Добавить вариант" onChange={options => setField(index, { options })} />
                </Row>
              ) : (
                <Row label="Подсказка в поле" stack>
                  <TextField label="Подсказка в поле" value={field.placeholder ?? ""} maxLength={200} placeholder="Например: +7 900 000-00-00" onChange={placeholder => setField(index, { placeholder })} />
                </Row>
              )}
              <Toggle label="Обязательное" checked={field.required} onChange={required => setField(index, { required })} />
            </div>
          ))}
          {form.fields.length < 20 && (
            <button type="button" className={s.addButton} onClick={() => w.setPrechat(p => ({ ...p, fields: [...p.fields, { name: `field_${Date.now()}`, label: "", type: "text", required: false, placeholder: "" }] }))}>
              <Plus aria-hidden />Добавить поле
            </button>
          )}
          <Note>Чем короче форма, тем чаще посетители до неё доходят. Обычно хватает имени и телефона.</Note>
        </Section>
      )}
    </>
  );
}
