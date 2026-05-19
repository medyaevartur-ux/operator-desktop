import { useEffect, useMemo, useState } from "react";
import { Users, MessageSquare, Activity, TrendingUp, Filter, Flame } from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import type { SiteVisitor } from "@/types/visitor";
import s from "./VisitorsStats.module.css";

interface Props {
  visitors: SiteVisitor[];
  onlineCount: number;
}

function useRolling(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let raf = 0;
    const from = 0;
    const animate = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * ease));
      if (t < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function Kpi({
  icon: Icon, label, value, sub, trend,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  sub?: string;
  trend?: { dir: "up" | "down"; text: string };
}) {
  const rolling = useRolling(value);
  return (
    <div className={s.kpi}>
      <div className={s.kpiHead}>
        <span className={s.kpiIcon}><Icon style={{ width: 14, height: 14 }} /></span>
        {label}
      </div>
      <div className={s.kpiValue}>{rolling.toLocaleString("ru-RU")}</div>
      {(sub || trend) && (
        <div className={s.kpiSub}>
          {trend && (
            <span className={trend.dir === "up" ? s.kpiTrendUp : s.kpiTrendDown}>
              {trend.dir === "up" ? "▲" : "▼"} {trend.text}
            </span>
          )}
          {sub}
        </div>
      )}
    </div>
  );
}

export function VisitorsStats({ visitors, onlineCount }: Props) {
  const sessions = useInboxStore((st) => st.sessions);

  // Базовая воронка из текущих сессий — без серверного API.
  const funnel = useMemo(() => {
    const totalVisitors = visitors.length || 0;
    const engaged = visitors.filter((v) => v.has_chat).length;
    const withChat = sessions.length;
    const operatorChat = sessions.filter((s) => s.status === "with_operator" || s.operator_id).length;
    const closedWithRating = sessions.filter((s) => s.status === "closed").length;

    const steps = [
      { label: "Зашли на сайт", value: totalVisitors },
      { label: "Активные / engaged", value: engaged },
      { label: "Начали чат", value: withChat },
      { label: "С оператором", value: operatorChat },
      { label: "Завершено", value: closedWithRating },
    ];
    const max = Math.max(1, ...steps.map((s) => s.value));
    return steps.map((step, idx) => {
      const prev = idx > 0 ? steps[idx - 1].value : step.value;
      const pct = step.value > 0 && prev > 0 ? Math.round((step.value / prev) * 100) : 0;
      const widthPct = (step.value / max) * 100;
      return { ...step, pct, widthPct };
    });
  }, [visitors, sessions]);

  // Heatmap часов × дней по last_message_at сессий за последние 14 дней.
  const heatmap = useMemo(() => {
    const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const now = new Date();
    const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
    for (const ses of sessions) {
      const ts = ses.last_message_at ? new Date(ses.last_message_at).getTime() : 0;
      if (!ts || ts < cutoff) continue;
      const d = new Date(ts);
      const day = (d.getDay() + 6) % 7; // ПН=0
      grid[day][d.getHours()] += 1;
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max, days: DAYS };
  }, [sessions]);

  return (
    <>
      <div className={s.kpiRow}>
        <Kpi icon={Users} label="Сейчас на сайте" value={onlineCount} sub="онлайн прямо сейчас" />
        <Kpi icon={Activity} label="Всего посетителей" value={visitors.length} />
        <Kpi icon={MessageSquare} label="Активные чаты" value={sessions.filter((s) => s.status !== "closed").length} />
        <Kpi icon={TrendingUp} label="Завершено" value={sessions.filter((s) => s.status === "closed").length} sub="за всё время" />
      </div>

      <div className={s.funnel}>
        <div className={s.funnelTitle}><Filter style={{ width: 16, height: 16 }} /> Воронка вовлечения</div>
        {funnel.map((step, idx) => (
          <div key={step.label} className={s.funnelStep}>
            <div className={s.funnelLabel}>{step.label}</div>
            <div className={s.funnelBarTrack}>
              <div className={s.funnelBar} style={{ width: `${Math.max(step.widthPct, 2)}%` }}>
                {step.value > 0 ? step.value.toLocaleString("ru-RU") : ""}
              </div>
            </div>
            <div className={s.funnelPercent}>{idx === 0 ? "100%" : `${step.pct}%`}</div>
          </div>
        ))}
      </div>

      <div className={s.heatmap}>
        <div className={s.heatmapTitle}><Flame style={{ width: 16, height: 16 }} /> Нагрузка по часам · 14 дней</div>
        <div className={s.heatmapGrid}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className={s.heatmapHeader}>{h % 3 === 0 ? h : ""}</div>
          ))}
          {heatmap.days.map((day, di) => (
            <Row key={day} day={day} cells={heatmap.grid[di]} max={heatmap.max} />
          ))}
        </div>
      </div>
    </>
  );
}

function Row({ day, cells, max }: { day: string; cells: number[]; max: number }) {
  return (
    <>
      <div className={s.heatmapDay}>{day}</div>
      {cells.map((value, h) => {
        const intensity = value / max;
        const bg = value === 0
          ? "var(--surface-2)"
          : `rgba(217, 119, 6, ${0.18 + intensity * 0.7})`;
        return (
          <div
            key={h}
            className={s.heatmapCell}
            style={{ background: bg }}
            title={`${day} ${h}:00 — ${value} ${value === 1 ? "чат" : "чатов"}`}
          />
        );
      })}
    </>
  );
}
