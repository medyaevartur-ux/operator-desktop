import { useEffect, useState } from "react";
import { Globe, MapPin, ArrowDownRight } from "lucide-react";
import { getVisitorPath } from "./visitors.api";
import type { SiteVisitor, VisitorPathStep } from "@/types/visitor";
import s from "./VisitorJourney.module.css";

interface VisitorJourneyProps {
  visitor: SiteVisitor;
}

function refHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function pagePath(url: string): string {
  try {
    const u = new URL(url, "http://x");
    return (u.pathname || "/") + (u.search || "");
  } catch {
    return url;
  }
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Строит fallback-путь из данных самого посетителя, когда серверный эндпоинт
 * пуст: реферер (если есть) → текущая страница «сейчас здесь».
 */
function fallbackSteps(visitor: SiteVisitor): VisitorPathStep[] {
  const steps: VisitorPathStep[] = [];
  if (visitor.referrer && visitor.referrer.trim()) {
    steps.push({
      page: visitor.referrer,
      title: refHost(visitor.referrer),
      is_referrer: true,
    });
  }
  steps.push({
    page: visitor.current_page || "—",
    title: visitor.current_page_title || visitor.current_page || "Текущая страница",
    visited_at: visitor.last_seen_at,
    is_current: true,
  });
  return steps;
}

/**
 * Вертикальный timeline пути посетителя: реферер → стр.1 → … → текущая
 * с бейджем «сейчас здесь». Заполняется из getVisitorPath, при пустом ответе —
 * fallback на current_page.
 */
export function VisitorJourney({ visitor }: VisitorJourneyProps) {
  const [steps, setSteps] = useState<VisitorPathStep[]>(() => fallbackSteps(visitor));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVisitorPath(visitor.visitor_id)
      .then((path) => {
        if (cancelled) return;
        if (path && path.length > 0) {
          // Гарантируем, что последний шаг помечен как текущий, если сервер не пометил.
          const hasCurrent = path.some((p) => p.is_current);
          const normalized = hasCurrent
            ? path
            : path.map((p, i) => (i === path.length - 1 ? { ...p, is_current: true } : p));
          setSteps(normalized);
        } else {
          setSteps(fallbackSteps(visitor));
        }
      })
      .catch(() => {
        if (!cancelled) setSteps(fallbackSteps(visitor));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitor.visitor_id]);

  return (
    <div className={s.journey}>
      {steps.map((step, i) => {
        const isCurrent = Boolean(step.is_current);
        const isReferrer = Boolean(step.is_referrer);
        const isLast = i === steps.length - 1;
        const label = step.title || (isReferrer ? refHost(step.page) : pagePath(step.page));
        const sub = isReferrer ? "Источник перехода" : pagePath(step.page);

        return (
          <div key={`${step.page}-${i}`} className={s.step}>
            <div className={s.rail}>
              <div
                className={`${s.node} ${isCurrent ? s.nodeCurrent : ""} ${
                  isReferrer ? s.nodeReferrer : ""
                }`}
              >
                {isReferrer ? (
                  <Globe style={{ width: 12, height: 12 }} />
                ) : isCurrent ? (
                  <MapPin style={{ width: 12, height: 12 }} />
                ) : (
                  <ArrowDownRight style={{ width: 12, height: 12 }} />
                )}
              </div>
              {!isLast && <div className={s.connector} />}
            </div>

            <div className={s.body}>
              <div className={s.topLine}>
                <span className={`${s.label} ${isCurrent ? s.labelCurrent : ""}`}>{label}</span>
                {isCurrent && <span className={s.nowBadge}>сейчас здесь</span>}
                {step.visited_at && <span className={s.time}>{formatTime(step.visited_at)}</span>}
              </div>
              <div className={s.sub}>{sub}</div>
            </div>
          </div>
        );
      })}

      {loading && steps.length === 0 && <div className={s.loading}>Загрузка пути…</div>}
    </div>
  );
}
