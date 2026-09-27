import { create } from "zustand";
import { api } from "@/lib/api";
import { getSessionDisplayName } from "@/features/inbox/inbox.utils";
export const DEFAULT_TEMPLATE_CATEGORY = "Общие";
export interface QuickTemplate { id: string; shortcut: string; title: string; body: string; category: string; folder?: string; uses: number; createdAt: number; revision?: number }
export interface ResolveVars { name?: string | null; visitor_id?: string | null; operator?: string | null }
type TemplateInput = Omit<QuickTemplate, "id" | "uses" | "createdAt" | "revision">;
interface TemplatesState {
  templates: QuickTemplate[]; loading: boolean; error: string | null;
  load: () => Promise<void>; add: (data: TemplateInput) => Promise<void>; update: (id: string, data: Partial<QuickTemplate>) => Promise<void>;
  remove: (id: string) => Promise<void>; incrementUses: (id: string) => void;
  importLegacy: () => Promise<{ imported: string[]; conflicts: string[] }>;
  resolveBody: (body: string, vars: ResolveVars) => string; categories: () => string[];
  searchTemplates: (query: string) => QuickTemplate[]; findByShortcut: (shortcut: string) => QuickTemplate | undefined;
  templatesByCategory: () => Record<string, QuickTemplate[]>;
}
const normalize = (value: string) => value.trim().replace(/^\/*/, "/").toLowerCase();
export function legacyTemplates(): QuickTemplate[] {
  try { const value = JSON.parse(localStorage.getItem("zhivaya-skazka-templates") || "null"); return Array.isArray(value?.state?.templates) ? value.state.templates : []; } catch { return []; }
}
export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: [], loading: false, error: null,
  load: async () => {
    set({ loading: true, error: null });
    try { set({ templates: await api<QuickTemplate[]>("/api/chat-v8/templates") }); }
    catch (error) { set({ error: error instanceof Error ? error.message : "Не удалось загрузить шаблоны" }); }
    finally { set({ loading: false }); }
  },
  add: async data => {
    const created = await api<QuickTemplate>("/api/chat-v8/templates", { method: "POST", body: JSON.stringify({ ...data, shortcut: normalize(data.shortcut) }) });
    set(state => ({ templates: [...state.templates.filter(item => item.id !== created.id), created] }));
  },
  update: async (id, data) => {
    const previous = get().templates.find(item => item.id === id);
    if (!previous) throw new Error("Обновите список шаблонов");
    const updated = await api<QuickTemplate>(`/api/chat-v8/templates/${id}`, { method: "PUT", body: JSON.stringify({ ...previous, ...data, shortcut: normalize(data.shortcut ?? previous.shortcut) }) });
    set(state => ({ templates: state.templates.map(item => item.id === id ? updated : item) }));
  },
  remove: async id => { await api(`/api/chat-v8/templates/${id}`, { method: "DELETE" }); set(state => ({ templates: state.templates.filter(item => item.id !== id) })); },
  incrementUses: id => {
    set(state => ({ templates: state.templates.map(item => item.id === id ? { ...item, uses: item.uses + 1 } : item) }));
    void api(`/api/chat-v8/templates/${id}/use`, { method: "POST" }).catch(() => undefined);
  },
  importLegacy: async () => {
    const templates = legacyTemplates().map((item, index) => ({ title: item.title, shortcut: normalize(item.shortcut || `старый-${index + 1}`), body: item.body, category: item.category || "Общие" }));
    const result = await api<{ imported: string[]; conflicts: string[] }>("/api/chat-v8/templates/import", { method: "POST", body: JSON.stringify({ templates }) });
    await get().load(); return result;
  },
  resolveBody: (body, vars) => body.replace(/\{\{name\}\}/g, getSessionDisplayName(vars.name ?? null, vars.visitor_id ?? "")).replace(/\{\{operator\}\}/g, vars.operator?.trim() || "").replace(/\{\{date\}\}/g, new Date().toLocaleDateString("ru-RU")),
  categories: () => Array.from(new Set(get().templates.map(item => item.category))).sort((a,b) => a.localeCompare(b,"ru")),
  searchTemplates: query => get().templates.filter(item => [item.title,item.shortcut,item.body].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))),
  findByShortcut: shortcut => get().templates.find(item => item.shortcut === normalize(shortcut)),
  templatesByCategory: () => get().templates.reduce<Record<string, QuickTemplate[]>>((groups, item) => { (groups[item.category] ||= []).push(item); return groups; }, {}),
}));
export function applyTemplate(tpl: QuickTemplate, session: { visitor_name?: string | null; visitor_id?: string | null } | null | undefined, operator: { name?: string | null; email?: string | null } | null | undefined) {
  const store = useTemplatesStore.getState();
  store.incrementUses(tpl.id);
  return store.resolveBody(tpl.body, { name: session?.visitor_name, visitor_id: session?.visitor_id, operator: operator?.name || operator?.email });
}
