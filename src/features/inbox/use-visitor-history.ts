import { useState, useEffect } from "react";
import {
  getVisitorSessions,
  getVisitorSummary,
  type VisitorSessionsResponse,
  type VisitorSummaryResponse,
} from "./inbox.api";

export function useVisitorHistory(visitorId: string | null | undefined) {
  const [data, setData] = useState<VisitorSessionsResponse | null>(null);
  const [summary, setSummary] = useState<VisitorSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!visitorId) {
      setData(null);
      setSummary(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      getVisitorSessions(visitorId),
      getVisitorSummary(visitorId),
    ])
      .then(([sessions, sum]) => {
        if (cancelled) return;
        setData(sessions);
        setSummary(sum);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [visitorId]);

  return { data, summary, isLoading };
}