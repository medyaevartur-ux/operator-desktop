import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNotificationStore } from "@/store/notification.store";
import type { SiteVisitor } from "@/types/visitor";

export function useVisitorsRealtime() {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onOnline = (visitor: SiteVisitor) => {
      const store = useVisitorsStore.getState();
      const isAlreadyOnline = store.visitors.some(
        (v) => v.visitor_id === visitor.visitor_id && v.is_online
      );
      store.upsertVisitor(visitor);

      if (!isAlreadyOnline && visitor.is_online) {
        useNotificationStore.getState().playSound("new_visitor");
      }
    };

    const onOffline = (data: { visitor_id: string }) => {
      useVisitorsStore.getState().removeVisitor(data.visitor_id);
    };

    const onPageChanged = (data: { visitor_id: string; page: string; title: string }) => {
      useVisitorsStore.getState().updateVisitorPage(data.visitor_id, data.page, data.title);
    };

    // ─ Живая карта пути ─
    // Сервер шлёт шаг пути при каждом переходе посетителя. Добавляем его в кэш
    // пути (livePaths) — VisitorJourney открытой карточки мгновенно подхватит.
    const onPathStep = (data: {
      visitor_id: string;
      page: string;
      title?: string;
      visited_at?: string;
      is_current?: boolean;
    }) => {
      if (!data?.visitor_id || !data.page) return;
      useVisitorsStore.getState().appendVisitorPathStep(data.visitor_id, {
        page: data.page,
        title: data.title,
        visited_at: data.visited_at,
        is_current: data.is_current ?? true,
      });
    };

    socket.on("visitor_online", onOnline);
    socket.on("visitor_offline", onOffline);
    socket.on("visitor_page_changed", onPageChanged);
    socket.on("visitor_path_step", onPathStep);

    return () => {
      socket.off("visitor_online", onOnline);
      socket.off("visitor_offline", onOffline);
      socket.off("visitor_page_changed", onPageChanged);
      socket.off("visitor_path_step", onPathStep);
    };
  }, []);
}