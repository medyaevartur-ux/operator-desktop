// Лёгкий рантайм сценариев виджет-бота (Node).
// Читает сценарии из таблицы widget_scenarios (тот же JSON-формат узлов/рёбер,
// что и визуальный конструктор), исполняет подмножество узлов и шлёт сообщения
// в чат виджета. ВК-движок (Python) НЕ задействован.
import { pool } from "../../db.js";
import type { Server } from "socket.io";

type WNode = { id: string; type: string; data?: any };
type WEdge = { source: string; target: string; sourceHandle?: string };
type Scenario = {
  id: number;
  name: string;
  start_node_id: string;
  nodes: WNode[];
  edges: WEdge[];
  version: number;
};

const MAX_STEPS = 80;

function mapRow(r: any): Scenario {
  return {
    id: r.id,
    name: r.name,
    start_node_id: r.start_node_id,
    nodes: Array.isArray(r.nodes) ? r.nodes : [],
    edges: Array.isArray(r.edges) ? r.edges : [],
    version: r.version,
  };
}

export async function getActiveWidgetScenario(): Promise<Scenario | null> {
  const { rows } = await pool.query(
    `SELECT id, name, start_node_id, nodes, edges, version
     FROM widget_scenarios WHERE is_active = true
     ORDER BY updated_at DESC LIMIT 1`
  );
  return rows.length ? mapRow(rows[0]) : null;
}

async function getScenarioById(id: number): Promise<Scenario | null> {
  const { rows } = await pool.query(
    `SELECT id, name, start_node_id, nodes, edges, version FROM widget_scenarios WHERE id = $1`,
    [id]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

async function getState(sessionId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM widget_scenario_states WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function saveState(
  sessionId: string,
  scenarioId: number,
  nodeId: string | null,
  context: any,
  completed: boolean
) {
  await pool.query(
    `INSERT INTO widget_scenario_states (session_id, scenario_id, current_node_id, context, is_completed, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       scenario_id = EXCLUDED.scenario_id,
       current_node_id = EXCLUDED.current_node_id,
       context = EXCLUDED.context,
       is_completed = EXCLUDED.is_completed,
       updated_at = NOW()`,
    [sessionId, scenarioId, nodeId, JSON.stringify(context || {}), completed]
  );
}

// Бот работает только пока сессией НЕ занимается оператор (Поведение 2).
async function sessionFree(sessionId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT operator_id FROM widget_chat_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!rows.length) return false;
  return !rows[0].operator_id;
}

function render(text: string, ctx: any): string {
  if (!text) return "";
  const vars = (ctx && ctx.vars) || {};
  return text.replace(/\{(\w+)\}/g, (_m: string, k: string) =>
    vars[k] != null ? String(vars[k]) : ""
  );
}

function findNode(sc: Scenario, id: string | null): WNode | null {
  if (!id) return null;
  return sc.nodes.find((n) => n.id === id) || null;
}

function nextByHandle(sc: Scenario, nodeId: string, handle: string): string | null {
  const e = sc.edges.find(
    (x) => x.source === nodeId && (x.sourceHandle || "default") === handle
  );
  return e ? e.target : null;
}

function defaultNext(sc: Scenario, nodeId: string): string | null {
  const e = sc.edges.find(
    (x) => x.source === nodeId && (x.sourceHandle || "default") === "default"
  );
  if (e) return e.target;
  const outs = sc.edges.filter((x) => x.source === nodeId);
  return outs.length ? outs[0].target : null;
}

async function sendBot(io: Server, sessionId: string, text: string, metadata: any, attachments?: any) {
  const { rows } = await pool.query(
    `INSERT INTO widget_chat_messages (session_id, sender, message, message_type, status, metadata, attachments)
     VALUES ($1, 'ai', $2, 'text', 'sent', $3, $4) RETURNING *`,
    [sessionId, text || "", metadata ? JSON.stringify(metadata) : null, attachments ? JSON.stringify(attachments) : null]
  );
  await pool.query(
    `UPDATE widget_chat_sessions
       SET last_message_at = NOW(),
           messages_count = COALESCE(messages_count, 0) + 1,
           ai_messages_count = COALESCE(ai_messages_count, 0) + 1,
           updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
  const msg = rows[0];
  io.to(`session:${sessionId}`).emit("new_message", msg);
  io.emit("session_updated", { session_id: sessionId });
  return msg;
}

function buildMenuButtons(node: WNode) {
  const btns = (node.data?.buttons || []) as any[];
  return btns.map((b, i) => ({
    handle: `btn-${i}`,
    label: b.label || `Кнопка ${i + 1}`,
    color: b.color || "primary",
    row: b.row ?? 0,
  }));
}

// Резолв id вложений ВК → публичный URL (selectel_url / external_url). Только чтение.
async function resolveAttachUrls(ids: number[]): Promise<Record<number, string>> {
  const uniq = Array.from(new Set(ids.filter((x) => Number.isFinite(x))));
  if (!uniq.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT id, COALESCE(selectel_url, external_url) AS url
       FROM vk_bot_attachments WHERE id = ANY($1::int[])`,
      [uniq]
    );
    const map: Record<number, string> = {};
    for (const r of rows) if (r.url) map[r.id] = r.url;
    return map;
  } catch {
    return {};
  }
}

// Вложения сообщения (attachments_ids ВК) → [{url}] для рендера картинки в виджете
async function buildAttachments(node: WNode): Promise<any[] | null> {
  const ids = ((node.data?.attachments_ids || []) as any[]).filter((x) => x != null);
  if (!ids.length) return null;
  const urls = await resolveAttachUrls(ids);
  const arr = ids.map((id) => urls[id]).filter(Boolean).map((u) => ({ url: u }));
  return arr.length ? arr : null;
}

async function buildCards(node: WNode) {
  const els = (node.data?.carousel_elements || []) as any[];
  const ids = els.map((el) => el.photo_attachment_id).filter((x) => x != null);
  const urls = await resolveAttachUrls(ids);
  return els.map((el, e) => ({
    title: el.title || "",
    description: el.description || "",
    image:
      el.image_url ||
      el.image ||
      (el.photo_attachment_id != null ? urls[el.photo_attachment_id] || null : null),
    buttons: (el.buttons || []).map((b: any, bi: number) => ({
      handle: `carousel_btn_e${e}_b${bi}`,
      label: b.label || "Подробнее",
      color: b.color || "primary",
      url: b.url || null,
    })),
  }));
}

function evalCondition(node: WNode, ctx: any): boolean {
  const rules = (node.data?.rules || []) as any[];
  const op = (node.data?.operator || "AND").toUpperCase();
  if (!rules.length) return true;
  const text = String(ctx?.vars?._last ?? "").toLowerCase();
  const test = (r: any) => {
    const val = String(r.value ?? "").toLowerCase();
    let res = false;
    switch (r.type) {
      case "equals": res = text === val; break;
      case "contains": res = text.includes(val); break;
      case "starts_with": res = text.startsWith(val); break;
      case "ends_with": res = text.endsWith(val); break;
      case "is_empty": res = text.length === 0; break;
      case "not_empty": res = text.length > 0; break;
      default: res = text.includes(val);
    }
    return r.not ? !res : res;
  };
  return op === "OR" ? rules.some(test) : rules.every(test);
}

async function runChain(io: Server, sessionId: string, sc: Scenario, startId: string, ctx: any) {
  let nodeId: string | null = startId;
  let steps = 0;
  const visited = new Set<string>();
  while (nodeId && steps++ < MAX_STEPS) {
    const node = findNode(sc, nodeId);
    if (!node) break;
    const t = node.type;

    if (t === "start") {
      nodeId = defaultNext(sc, node.id);
      continue;
    }
    if (t === "message") {
      const text = render(node.data?.text || "", ctx);
      const atts = await buildAttachments(node);
      if (text || atts) await sendBot(io, sessionId, text, null, atts);
      const hasWait = Array.isArray(node.data?.waits) && node.data.waits.length > 0;
      if (hasWait) {
        await saveState(sessionId, sc.id, node.id, ctx, false);
        return;
      }
      nodeId = defaultNext(sc, node.id);
      continue;
    }
    if (t === "timer") {
      const text = render(node.data?.text || "", ctx);
      const atts = await buildAttachments(node);
      if (text || atts) await sendBot(io, sessionId, text, null, atts);
      nodeId = defaultNext(sc, node.id);
      continue;
    }
    if (t === "menu") {
      const text = render(node.data?.text || "", ctx);
      await sendBot(io, sessionId, text, { kind: "buttons", node: node.id, buttons: buildMenuButtons(node) });
      await saveState(sessionId, sc.id, node.id, ctx, false);
      return; // ждём клика по кнопке
    }
    if (t === "carousel") {
      const text = render(node.data?.text || "", ctx);
      const cards = await buildCards(node);
      await sendBot(io, sessionId, text, { kind: "cards", node: node.id, cards });
      await saveState(sessionId, sc.id, node.id, ctx, false);
      return; // ждём клика по карточке
    }
    if (t === "condition") {
      const ok = evalCondition(node, ctx);
      nodeId = nextByHandle(sc, node.id, ok ? "true" : "false") || defaultNext(sc, node.id);
      continue;
    }
    if (t === "reference") {
      // Прыжок на другой узел того же сценария
      const ref = node.data?.ref_node_id;
      // защита от циклов reference→reference
      const key = "ref:" + node.id;
      if (visited.has(key)) { nodeId = defaultNext(sc, node.id); continue; }
      visited.add(key);
      nodeId = ref || defaultNext(sc, node.id);
      continue;
    }
    if (t === "manager") {
      await pool.query(
        `UPDATE widget_chat_sessions
           SET status = 'waiting_operator', queued_at = COALESCE(queued_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND operator_id IS NULL`,
        [sessionId]
      );
      io.emit("session_updated", { session_id: sessionId });
      io.emit("queue_updated", { session_id: sessionId, action: "added" });
      await saveState(sessionId, sc.id, node.id, ctx, true);
      return;
    }
    if (t === "end") {
      await saveState(sessionId, sc.id, node.id, ctx, true);
      return;
    }
    // неизвестный тип → идём по default
    nodeId = defaultNext(sc, node.id);
  }
  await saveState(sessionId, sc.id, null, ctx, true);
}

export async function startWidgetScenario(io: Server, sessionId: string, scenarioId?: number) {
  if (!(await sessionFree(sessionId))) return { ok: false, reason: "operator_assigned" };
  const sc = scenarioId ? await getScenarioById(scenarioId) : await getActiveWidgetScenario();
  if (!sc) return { ok: false, reason: "no_scenario" };
  const { rows } = await pool.query(
    `SELECT visitor_name FROM widget_chat_sessions WHERE id = $1`,
    [sessionId]
  );
  const firstName = String(rows[0]?.visitor_name || "").trim().split(" ")[0] || "";
  const ctx = { vars: { first_name: firstName } as Record<string, any> };
  // start_node_id может быть пустым (как в сценариях ВК) — тогда ищем узел type='start'
  const startId = sc.start_node_id || (sc.nodes.find((n) => n.type === "start") || ({} as WNode)).id;
  if (!startId) return { ok: false, reason: "no_start" };
  await runChain(io, sessionId, sc, startId, ctx);
  return { ok: true, scenario_id: sc.id };
}

export async function handleWidgetBotEvent(io: Server, sessionId: string, body: any) {
  if (!(await sessionFree(sessionId))) return { ok: false, reason: "operator_assigned" };

  const st = await getState(sessionId);
  // Продолжаем тот сценарий, который сессия начала (а не обязательно текущий активный)
  const sc = st?.scenario_id ? await getScenarioById(st.scenario_id) : await getActiveWidgetScenario();
  if (!sc) return { ok: false, reason: "no_scenario" };

  const ctx = (st?.context as any) || { vars: {} };
  if (!ctx.vars) ctx.vars = {};

  const nodeId: string | null = body?.node_id || st?.current_node_id || null;
  const handle: string = body?.handle || "default";
  if (body?.value != null) ctx.vars._last = String(body.value);

  if (!nodeId) {
    return startWidgetScenario(io, sessionId, sc.id);
  }

  const target = nextByHandle(sc, nodeId, handle) || defaultNext(sc, nodeId);
  if (!target) return { ok: false, reason: "no_edge" };

  await runChain(io, sessionId, sc, target, ctx);
  return { ok: true };
}
