import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Globe,
  Clock,
  Link2,
  Ban,
  TrendingUp,
  MessageSquare,
  Monitor,
  Smartphone,
  Eye,
  Activity,
  History,
  Calendar,
} from "lucide-react";
import { useVisitorsStore } from "@/store/visitors.store";
import { useInboxStore } from "@/store/inbox.store";
import { useConfirm, Button } from "@/components/ui";
import { getVisitorHistory, blockVisitorIP, startChatWithVisitor } from "@/features/visitors/visitors.api";
import type { SiteVisitor, VisitorPageEvent } from "@/types/visitor";
import s from "./VisitorHistoryDrawer.module.css";

interface VisitorHistoryDrawerProps {
  visitorId: string | null;
  onClose: () => void;
}

export function VisitorHistoryDrawer({ visitorId, onClose }: VisitorHistoryDrawerProps) {
  const [history, setHistory] = useState<VisitorPageEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [visitor, setVisitor] = useState<SiteVisitor | null>(null);

  const visitors = useVisitorsStore((st) => st.visitors);
  const blockVisitorLocal = useVisitorsStore((st) => st.blockVisitorIP);
  const { confirm } = useConfirm();

  // Find the visitor object from store
  useEffect(() => {
    if (visitorId) {
      const found = visitors.find((v) => v.visitor_id === visitorId);
      if (found) {
        setVisitor(found);
      }
    } else {
      setVisitor(null);
    }
  }, [visitorId, visitors]);

  // Load history from API
  useEffect(() => {
    if (!visitorId) {
      setHistory([]);
      return;
    }

    const loadHistory = async () => {
      try {
        setIsLoading(true);
        const data = await getVisitorHistory(visitorId);
        // Sort history by date descending
        const sorted = [...data].sort(
          (a, b) => new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime()
        );
        setHistory(sorted);
      } catch (err) {
        console.error("Failed to load visitor history:", err);
      } finally {
        setIsLoading(false);
      }
    };

    void loadHistory();
  }, [visitorId]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && visitorId) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visitorId, onClose]);

  if (!visitorId || !visitor) return null;

  // Format country emoji flag
  const getCountryFlag = (countryCode: string | null) => {
    if (!countryCode) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split("")
      .map((char) => 127397 + char.charCodeAt(0));
    try {
      return String.fromCodePoint(...codePoints);
    } catch {
      return "🌐";
    }
  };

  // Format date nicely
  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      });
    } catch {
      return "";
    }
  };

  // Calculate time spent on each page
  const calculateDuration = (currentIdx: number) => {
    if (currentIdx === 0) {
      if (visitor.is_online) {
        // Online right now, show active
        return "активен";
      }
      return "вышел";
    }

    const currentEvent = history[currentIdx];
    const nextEvent = history[currentIdx - 1]; // next chronologically (which is index - 1 because we sorted desc)

    if (!currentEvent || !nextEvent) return "";

    const diffMs = new Date(nextEvent.visited_at).getTime() - new Date(currentEvent.visited_at).getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));

    if (diffSecs < 60) {
      return `${diffSecs} сек`;
    }
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return `${mins} мин ${secs} сек`;
  };

  // Handle Ban
  const handleBan = async () => {
    const ok = await confirm({
      title: "Заблокировать посетителя?",
      message: `IP-адрес посетителя будет занесён в чёрный список. Он больше не сможет отправлять сообщения в виджет.`,
      confirmText: "Заблокировать",
      cancelText: "Отмена",
      danger: true,
    });

    if (!ok) return;

    try {
      await blockVisitorIP(visitor.visitor_id, "");
      blockVisitorLocal(visitor.visitor_id);
      onClose();
    } catch (err) {
      console.error("Failed to block IP:", err);
    }
  };

  // Handle Start Chat
  const handleStartChat = async () => {
    try {
      if (visitor.has_chat && visitor.chat_session_id) {
        // Already has chat, just select it
        const inboxStore = useInboxStore.getState();
        await inboxStore.loadSessions();
        const session = inboxStore.sessions.find((s) => s.id === visitor.chat_session_id);
        if (session) {
          inboxStore.setActiveSession(session);
        }
      } else {
        // Start new chat
        const { session_id } = await startChatWithVisitor(visitor.visitor_id);
        const inboxStore = useInboxStore.getState();
        await inboxStore.loadSessions();
        const session = inboxStore.sessions.find((s) => s.id === session_id);
        if (session) {
          inboxStore.setActiveSession(session);
        }
      }
      onClose();
    } catch (err) {
      console.error("Failed to start chat with visitor:", err);
    }
  };

  const timeOnSite = (() => {
    if (visitor.first_seen_at && visitor.last_seen_at) {
      const diffMs = new Date(visitor.last_seen_at).getTime() - new Date(visitor.first_seen_at).getTime();
      const secs = Math.max(0, Math.floor(diffMs / 1000));
      if (secs < 60) return `${secs} сек`;
      const mins = Math.floor(secs / 60);
      return `${mins} мин ${secs % 60} сек`;
    }
    return "Неизвестно";
  })();

  const isCommercialPage = (page: string) => {
    const p = page.toLowerCase();
    return (
      p.includes("cart") ||
      p.includes("price") ||
      p.includes("checkout") ||
      p.includes("buy") ||
      p.includes("pricing") ||
      p.includes("product") ||
      p.includes("shop")
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        className={s.overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={s.drawer}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={s.header}>
            <div className={s.headerTitle}>
              <History style={{ width: 20, height: 20, color: "var(--accent)" }} />
              Путь посетителя #{visitor.visitor_id.substring(0, 6)}
            </div>
            <button className={s.closeBtn} onClick={onClose} aria-label="Закрыть">
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>

          {/* Content */}
          <div className={s.content}>
            {/* Stats */}
            <div className={s.section}>
              <div className={s.sectionTitle}>Сводная аналитика</div>
              <div className={s.statsGrid}>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Lead Score</span>
                  <span
                    className={s.statValue}
                    style={{
                      color:
                        (visitor.score || 0) >= 70
                          ? "#ef4444"
                          : (visitor.score || 0) >= 40
                          ? "#f59e0b"
                          : "var(--text-muted)",
                    }}
                  >
                    <TrendingUp style={{ width: 16, height: 16 }} />
                    {visitor.score || 0} XP
                  </span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Время на сайте</span>
                  <span className={s.statValue}>
                    <Clock style={{ width: 16, height: 16 }} />
                    {timeOnSite}
                  </span>
                </div>
              </div>
            </div>

            {/* General Info */}
            <div className={s.section}>
              <div className={s.sectionTitle}>Информация об устройстве</div>
              <div className={s.infoList}>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Геолокация</span>
                  <span className={s.infoValue}>
                    {getCountryFlag(visitor.country)} {[visitor.city, visitor.country].filter(Boolean).join(", ") || "Неизвестно"}
                  </span>
                </div>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Устройство</span>
                  <span className={s.infoValue} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {visitor.os?.toLowerCase().includes("windows") || visitor.os?.toLowerCase().includes("mac") || visitor.os?.toLowerCase().includes("linux") ? (
                      <Monitor style={{ width: 14, height: 14 }} />
                    ) : (
                      <Smartphone style={{ width: 14, height: 14 }} />
                    )}
                    {visitor.os || "Неизвестно"}
                  </span>
                </div>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Браузер</span>
                  <span className={s.infoValue}>{visitor.browser || "Неизвестно"}</span>
                </div>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Сессий / Визитов</span>
                  <span className={s.infoValue}>{visitor.session_count || 1}</span>
                </div>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Реферер</span>
                  <span className={s.infoValue} title={visitor.referrer || "Прямой переход"}>
                    {visitor.referrer || "Прямой переход"}
                  </span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className={s.section} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className={s.sectionTitle} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Activity style={{ width: 14, height: 14 }} />
                Хроника переходов ({history.length})
              </div>

              {isLoading ? (
                <div className={s.loadingContainer}>
                  <div className={s.loadingSpinner} />
                  Загружаем путь...
                </div>
              ) : history.length === 0 ? (
                <div className={s.loadingContainer}>Нет данных о перекрестках страниц</div>
              ) : (
                <div className={`${s.timeline} scrollbar-thin`}>
                  {history.map((event, idx) => {
                    const isCommercial = isCommercialPage(event.page);
                    const duration = calculateDuration(idx);
                    return (
                      <div
                        key={idx}
                        className={`${s.timelineItem} ${idx === 0 ? s.timelineItemActive : ""}`}
                      >
                        <div className={s.timelineDot} />
                        <div
                          className={s.timelineContent}
                          style={
                            isCommercial
                              ? { borderLeft: "3px solid #f59e0b", background: "rgba(245, 158, 11, 0.02)" }
                              : {}
                          }
                        >
                          <div className={s.timelineHeader}>
                            <span className={s.timelineTime} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Calendar style={{ width: 10, height: 10 }} />
                              {formatDate(event.visited_at)} в {formatTime(event.visited_at)}
                            </span>
                            {duration && <span className={s.timelineDuration}>{duration}</span>}
                          </div>
                          <div className={s.timelineTitle}>{event.title || "Без названия"}</div>
                          <a
                            href={event.page}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={s.timelineUrl}
                          >
                            <Link2 style={{ width: 12, height: 12 }} />
                            {event.page}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className={s.footer}>
            <Button
              className={`${s.footerBtn} ${s.banBtn}`}
              onClick={handleBan}
            >
              <Ban style={{ width: 16, height: 16, marginRight: 8 }} />
              Бан по IP
            </Button>
            <Button
              variant="primary"
              className={s.footerBtn}
              onClick={handleStartChat}
            >
              <MessageSquare style={{ width: 16, height: 16, marginRight: 8 }} />
              {visitor.has_chat ? "Открыть чат" : "Начать чат"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
