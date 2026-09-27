import { useCallback, useEffect, useState } from "react";
import { offlineQueue, type OfflineMessage } from "@/lib/offline-queue";

/** Сообщения оператора, которые ещё не дошли до сервера (очередь и ошибки), в порядке создания. */
export function useOutbox(operatorId?: string) {
  const [items, setItems] = useState<OfflineMessage[]>([]);
  const load = useCallback(() => {
    if (!operatorId) { setItems([]); return; }
    void offlineQueue.getAll()
      .then(list => setItems(list.filter(item => item.operatorId === operatorId).sort((a, b) => a.created_at.localeCompare(b.created_at))))
      .catch(() => setItems([]));
  }, [operatorId]);
  useEffect(() => {
    load();
    window.addEventListener("outbox-changed", load);
    return () => window.removeEventListener("outbox-changed", load);
  }, [load]);
  return items;
}
