import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface QuickTemplate {
  id: string;
  shortcut: string;       // например, "/привет"
  title: string;
  body: string;           // поддерживает {{name}} {{operator}} {{date}}
  folder?: string;
  uses: number;
  createdAt: number;
}

interface TemplatesState {
  templates: QuickTemplate[];
  add: (t: Omit<QuickTemplate, "id" | "uses" | "createdAt">) => void;
  update: (id: string, patch: Partial<QuickTemplate>) => void;
  remove: (id: string) => void;
  incrementUses: (id: string) => void;
  resolveBody: (body: string, vars: { name?: string; operator?: string }) => string;
}

const DEFAULTS: QuickTemplate[] = [
  { id: "t1", shortcut: "/привет", title: "Приветствие", body: "Здравствуйте, {{name}}! Чем могу помочь?", uses: 0, createdAt: Date.now() },
  { id: "t2", shortcut: "/оператор", title: "Передача", body: "Передаю ваш запрос оператору. Обычно отвечаем в течение 2–3 минут.", uses: 0, createdAt: Date.now() },
  { id: "t3", shortcut: "/уточнить", title: "Уточнение", body: "Подскажите, пожалуйста, ваш номер телефона для связи.", uses: 0, createdAt: Date.now() },
  { id: "t4", shortcut: "/спасибо", title: "Благодарность", body: "Спасибо за обращение! Если появятся вопросы — пишите.", uses: 0, createdAt: Date.now() },
];

export const useTemplatesStore = create<TemplatesState>()(
  persist(
    (set, get) => ({
      templates: DEFAULTS,
      add: (t) =>
        set({
          templates: [
            ...get().templates,
            { ...t, id: `t_${Date.now()}`, uses: 0, createdAt: Date.now() },
          ],
        }),
      update: (id, patch) =>
        set({
          templates: get().templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }),
      remove: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),
      incrementUses: (id) =>
        set({
          templates: get().templates.map((t) =>
            t.id === id ? { ...t, uses: t.uses + 1 } : t
          ),
        }),
      resolveBody: (body, vars) =>
        body
          .replace(/\{\{name\}\}/g, vars.name?.trim() || "")
          .replace(/\{\{operator\}\}/g, vars.operator?.trim() || "")
          .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("ru-RU")),
    }),
    { name: "zhivaya-skazka-templates" }
  )
);
