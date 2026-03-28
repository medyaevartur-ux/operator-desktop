import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useVisitorsStore } from "@/store/visitors.store";
import type { SiteVisitor } from "@/types/visitor";

export function useVisitorsRealtime() {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onOnline = (visitor: SiteVisitor) => {
      useVisitorsStore.getState().upsertVisitor(visitor);
    };

    const onOffline = (data: { visitor_id: string }) => {
      useVisitorsStore.getState().removeVisitor(data.visitor_id);
    };

    const onPageChanged = (data: { visitor_id: string; page: string; title: string }) => {
      useVisitorsStore.getState().updateVisitorPage(data.visitor_id, data.page, data.title);
    };

    socket.on("visitor_online", onOnline);
    socket.on("visitor_offline", onOffline);
    socket.on("visitor_page_changed", onPageChanged);

    return () => {
      socket.off("visitor_online", onOnline);
      socket.off("visitor_offline", onOffline);
      socket.off("visitor_page_changed", onPageChanged);
    };
  }, []);
}