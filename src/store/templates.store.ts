import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getSessionDisplayName } from "@/features/inbox/inbox.utils";

export const DEFAULT_TEMPLATE_CATEGORY = "Общие";

export interface QuickTemplate {
  id: string;
  shortcut: string;       // например, "/привет"
  title: string;
  body: string;           // поддерживает {{name}} {{operator}} {{date}}
  category: string;       // группировка карточек, по умолчанию «Общие»
  folder?: string;
  uses: number;
  createdAt: number;
}

/** Переменные для resolveBody. visitor_id используется как фолбэк для {{name}}. */
export interface ResolveVars {
  name?: string | null;
  visitor_id?: string | null;
  operator?: string | null;
}

interface TemplatesState {
  templates: QuickTemplate[];
  add: (t: Omit<QuickTemplate, "id" | "uses" | "createdAt">) => void;
  update: (id: string, patch: Partial<QuickTemplate>) => void;
  remove: (id: string) => void;
  incrementUses: (id: string) => void;
  resolveBody: (body: string, vars: ResolveVars) => string;
  /* ── Селекторы ── */
  categories: () => string[];
  searchTemplates: (q: string) => QuickTemplate[];
  findByShortcut: (token: string) => QuickTemplate | undefined;
  templatesByCategory: () => Record<string, QuickTemplate[]>;
}

const DEFAULTS: QuickTemplate[] = [
  { id: "t1", shortcut: "/привет", title: "Приветствие", body: "Здравствуйте, {{name}}! Чем могу помочь?", category: "Приветствия", uses: 0, createdAt: Date.now() },
  { id: "t2", shortcut: "/оператор", title: "Передача", body: "Передаю ваш запрос оператору. Обычно отвечаем в течение 2–3 минут.", category: "Общие", uses: 0, createdAt: Date.now() },
  { id: "t3", shortcut: "/уточнить", title: "Уточнение", body: "Подскажите, пожалуйста, ваш номер телефона для связи.", category: "Общие", uses: 0, createdAt: Date.now() },
  { id: "t4", shortcut: "/спасибо", title: "Благодарность", body: "Спасибо за обращение! Если появятся вопросы — пишите.", category: "Завершение", uses: 0, createdAt: Date.now() },
];

/** Нормализует shortcut к виду "/...": гарантирует ведущий «/», убирает пробелы. */
function normalizeShortcut(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export const useTemplatesStore = create<TemplatesState>()(
  persist(
    (set, get) => ({
      templates: DEFAULTS,
      add: (t) => {
        const shortcut = normalizeShortcut(t.shortcut);
        // Уникальность shortcut: если уже занят — не дублируем, очищаем у нового.
        const taken =
          !!shortcut &&
          get().templates.some((x) => x.shortcut.toLowerCase() === shortcut.toLowerCase());
        set({
          templates: [
            ...get().templates,
            {
              ...t,
              shortcut: taken ? "" : shortcut,
              category: t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY,
              id: `t_${Date.now()}`,
              uses: 0,
              createdAt: Date.now(),
            },
          ],
        });
      },
      update: (id, patch) => {
        const next = { ...patch };
        if (typeof next.shortcut === "string") {
          const shortcut = normalizeShortcut(next.shortcut);
          const taken =
            !!shortcut &&
            get().templates.some(
              (x) => x.id !== id && x.shortcut.toLowerCase() === shortcut.toLowerCase(),
            );
          // При коллизии оставляем прежний shortcut (не затираем чужой).
          next.shortcut = taken ? get().templates.find((x) => x.id === id)?.shortcut ?? "" : shortcut;
        }
        if (typeof next.category === "string") {
          next.category = next.category.trim() || DEFAULT_TEMPLATE_CATEGORY;
        }
        set({
          templates: get().templates.map((t) => (t.id === id ? { ...t, ...next } : t)),
        });
      },
      remove: (id) => set({ templates: get().templates.filter((t) => t.id !== id) }),
      incrementUses: (id) =>
        set({
          templates: get().templates.map((t) =>
            t.id === id ? { ...t, uses: t.uses + 1 } : t
          ),
        }),
      resolveBody: (body, vars) => {
        const name = getSessionDisplayName(vars.name ?? null, vars.visitor_id ?? "");
        const operator = vars.operator?.trim() || "";
        return body
          .replace(/\{\{name\}\}/g, name)
          .replace(/\{\{operator\}\}/g, operator)
          .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("ru-RU"));
      },

      /* ── Селекторы ── */
      categories: () => {
        const unique = new Set<string>();
        for (const t of get().templates) unique.add(t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY);
        return Array.from(unique).sort((a, b) => a.localeCompare(b, "ru"));
      },
      searchTemplates: (q) => {
        const query = q.trim().toLowerCase();
        const all = get().templates;
        if (!query) return all;
        return all.filter(
          (t) =>
            t.title.toLowerCase().includes(query) ||
            t.shortcut.toLowerCase().includes(query) ||
            t.body.toLowerCase().includes(query),
        );
      },
      findByShortcut: (token) => {
        const normalized = normalizeShortcut(token).toLowerCase();
        if (!normalized) return undefined;
        return get().templates.find((t) => t.shortcut.toLowerCase() === normalized);
      },
      templatesByCategory: () => {
        const map: Record<string, QuickTemplate[]> = {};
        for (const t of get().templates) {
          const cat = t.category?.trim() || DEFAULT_TEMPLATE_CATEGORY;
          (map[cat] ??= []).push(t);
        }
        for (const cat of Object.keys(map)) {
          map[cat].sort((a, b) => b.uses - a.uses);
        }
        return map;
      },
    }),
    {
      name: "zhivaya-skazka-templates",
      version: 2,
      migrate: (persisted: unknown) => {
        const state = persisted as Partial<TemplatesState> | undefined;
        if (state?.templates) {
          state.templates = state.templates.map((t) => ({
            ...t,
            category: (t as QuickTemplate).category?.trim() || DEFAULT_TEMPLATE_CATEGORY,
          }));
        }
        return state as TemplatesState;
      },
    }
  )
);

/** Единая точка: подставить переменные + засчитать использование шаблона. */
export function applyTemplate(
  tpl: QuickTemplate,
  session: { visitor_name?: string | null; visitor_id?: string | null } | null | undefined,
  operator: { name?: string | null; email?: string | null } | null | undefined,
): string {
  const { resolveBody, incrementUses } = useTemplatesStore.getState();
  const resolved = resolveBody(tpl.body, {
    name: session?.visitor_name ?? null,
    visitor_id: session?.visitor_id ?? null,
    operator: operator?.name?.trim() || operator?.email?.trim() || null,
  });
  incrementUses(tpl.id);
  return resolved;
}
