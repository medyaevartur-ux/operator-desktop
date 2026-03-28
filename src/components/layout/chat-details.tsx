import {
  Globe, Mail, MapPin, Phone, User, Clock,
  MessageCircle, Bot, UserCheck, Tag, ExternalLink,
  Copy, XCircle, CheckCheck, CircleDot, Pencil,
  Trash2, Plus, X, ArrowRightLeft, ChevronDown,
  Shield, Crown,
} from "lucide-react";
import { useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { Avatar, Select, Button, useConfirm } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { parseUserAgent } from "@/utils/parse-ua";
import {
  formatChatTime,
  getSessionStatusLabel,
} from "@/features/inbox/inbox.utils";
import s from "./ChatDetails.module.css";
import { useVisitorHistory } from "@/features/inbox/use-visitor-history";
import { SessionHistoryList } from "@/components/layout/session-history";
import { setSessionPriority } from "@/features/inbox/inbox.api";
/* ── helpers ── */

function statusClass(status: string) {
  if (status === "with_operator") return s.statusOperator;
  if (status === "ai") return s.statusAi;
  if (status === "closed") return s.statusClosed;
  return s.statusOther;
}

/* ── Sub-components ── */

function InfoRow({ icon, label, value, copyable }: {
  icon: React.ReactNode; label: string; value: string; copyable?: boolean;
}) {
  const empty = !value || value === "—";
  return (
    <div className={s.infoRow}>
      <div className={s.infoIcon}>{icon}</div>
      <div className={s.infoBody}>
        <div className={s.infoLabel}>{label}</div>
        <div className={`${s.infoValue} ${empty ? s.infoValueEmpty : ""}`}>{value || "—"}</div>
      </div>
      {copyable && !empty && (
        <button type="button" className={s.copyBtn} title="Скопировать"
          onClick={() => void navigator.clipboard.writeText(value)}>
          <Copy style={{ width: 13, height: 13 }} />
        </button>
      )}
    </div>
  );
}

function MetricRow({ icon, label, value }: {
  icon: React.ReactNode; label: string; value: string | number;
}) {
  return (
    <div className={s.metricRow}>
      <div className={s.metricLabel}>
        <span className={s.metricIcon}>{icon}</span>
        {label}
      </div>
      <span className={s.metricValue}>{value}</span>
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger className={s.collapsibleTrigger}>
        <span className={s.sectionTitle}>{title}</span>
        <ChevronDown className={s.collapsibleIcon} />
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/* ══════════════════════════════════
   ChatDetails
   ══════════════════════════════════ */

export function ChatDetails() {
  const {
    activeSession, closeActiveSession, assignActiveSession,
    markActiveSessionRead, markActiveSessionUnread,
    notes, isNotesLoading, createNote, updateNote, deleteNote,
    allTags, sessionTags, operators,
    isTagsLoading, isOperatorsLoading,
    createTagAndAttach, attachExistingTag, detachSessionTag,
    transferActiveSession,
  } = useInboxStore();

  const { operator } = useAuthStore();
  const { confirm } = useConfirm();
  const { data: visitorHistory, summary: visitorSummary, isLoading: isHistoryLoading } = useVisitorHistory(activeSession?.visitor_id);  

  const [noteValue, setNoteValue] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [selectedExistingTagId, setSelectedExistingTagId] = useState("");
  const [selectedTransferOperatorId, setSelectedTransferOperatorId] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<string>(activeSession?.priority || "normal");
  const displayName = activeSession
    ? getSessionDisplayName(activeSession.visitor_name, activeSession.visitor_id)
    : "";
  const isAssigned = !!activeSession?.operator_id && activeSession.operator_id === operator?.id;
  const hasUnread = (activeSession?.unread_count ?? 0) > 0;

  const availableTags = useMemo(() => {
    const ids = new Set(sessionTags.map((t) => t.tag_id));
    return allTags.filter((t) => !ids.has(t.id));
  }, [allTags, sessionTags]);

  const availableOperators = useMemo(() => {
    if (!activeSession) return operators;
    return operators.filter((o) => o.id !== activeSession.operator_id);
  }, [operators, activeSession]);

  const tagOptions = useMemo(() =>
    availableTags.map((t) => ({ value: t.id, label: t.name })),
    [availableTags],
  );

  const operatorOptions = useMemo(() =>
    availableOperators.map((o) => ({
      value: o.id,
      label: o.name || o.email || "Оператор",
    })),
    [availableOperators],
  );

  /* ── Empty ── */
  if (!activeSession) {
    return (
      <aside className={s.empty}>
        <div className={s.textCenter}>
          <div className={s.emptyTitle}>Нет клиента</div>
          <div className={s.emptyDesc}>Открой диалог слева, чтобы увидеть информацию о клиенте.</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`${s.aside} scrollbar-thin`}>
      {/* ── Hero ── */}
      <div className={s.hero}>
        <div className={s.heroBlob1} />
        <div className={s.heroBlob2} />
        <div className={s.heroContent}>
          <div className={s.heroRow}>
            <Avatar name={displayName} size="xl" />
            <div className={s.minW0}>
              <div className={s.heroName}>{displayName}</div>
              <div className={s.heroMeta}>
                <span className={`${s.statusPill} ${statusClass(activeSession.status)}`}>
                  {getSessionStatusLabel(activeSession.status)}
                </span>
                <span className={s.heroTime}>
                  {formatChatTime(activeSession.last_message_at ?? activeSession.created_at)}
                </span>
              </div>
            </div>
          </div>

          <div className={s.statGrid}>
            <div className={s.statCard}>
              <div className={s.statLabel}>Сообщений</div>
              <div className={s.statValue}>{activeSession.messages_count ?? 0}</div>
            </div>
            <div className={s.statCard}>
              <div className={s.statLabel}>Непрочитано</div>
              <div className={`${s.statValue} ${hasUnread ? s.statValueUnread : ""}`}>
                {activeSession.unread_count ?? 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs.Root defaultValue="client" className={s.body}>
        <Tabs.List className={s.tabsList}>
          <Tabs.Trigger value="client" className={s.tabTrigger}>Клиент</Tabs.Trigger>
          <Tabs.Trigger value="notes" className={s.tabTrigger}>Заметки</Tabs.Trigger>
          <Tabs.Trigger value="actions" className={s.tabTrigger}>Действия</Tabs.Trigger>
        </Tabs.List>

        {/* ═══ TAB: Клиент ═══ */}
        <Tabs.Content value="client">
          <div className={s.flexCol}>
            <CollapsibleSection title="Контакты">
              <div className={s.flexColTight}>
                <InfoRow icon={<User style={{ width: 15, height: 15 }} />} label="Имя" value={displayName} copyable />
                <InfoRow icon={<Mail style={{ width: 15, height: 15 }} />} label="Email" value={activeSession.visitor_email || "—"} copyable />
                <InfoRow icon={<Phone style={{ width: 15, height: 15 }} />} label="Телефон" value={activeSession.visitor_phone || "—"} copyable />
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Сессия">
              <div className={s.flexColTight}>
                <InfoRow icon={<Globe style={{ width: 15, height: 15 }} />} label="Браузер / ОС" value={parseUserAgent(activeSession.user_agent)} />
                {/* Сейчас на странице — live */}
                {activeSession.current_page && (
                  <div className={s.livePageBlock}>
                    <div className={s.livePageHeader}>
                      <span className={s.livePageDot} />
                      <span className={s.livePageLabel}>Сейчас на странице</span>
                    </div>
                    <a
                      href={`https://zhivaya-skazka.ru${activeSession.current_page}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={s.livePageLink}
                      title={activeSession.current_page}
                    >
                      <Globe style={{ width: 13, height: 13, flexShrink: 0 }} />
                      <span className={s.livePageUrl}>
                        {activeSession.current_page_title || activeSession.current_page}
                      </span>
                      <ExternalLink style={{ width: 11, height: 11, flexShrink: 0, opacity: 0.5 }} />
                    </a>
                  </div>
                )}
                {!activeSession.current_page && (
                  <InfoRow icon={<Globe style={{ width: 15, height: 15 }} />} label="Страница" value="—" />
                )}
                <InfoRow icon={<MapPin style={{ width: 15, height: 15 }} />} label="Геолокация" value={[activeSession.country, activeSession.city].filter(Boolean).join(", ") || "—"} />
                <InfoRow icon={<ExternalLink style={{ width: 15, height: 15 }} />} label="Источник" value={activeSession.utm_source || "—"} />
                <InfoRow icon={<Tag style={{ width: 15, height: 15 }} />} label="Visitor ID" value={activeSession.visitor_id} copyable />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title={`История обращений${visitorHistory && visitorHistory.total_sessions > 1 ? ` (${visitorHistory.total_sessions})` : ""}`}
              defaultOpen={false}
            >
              <div className={s.card}>
                {isHistoryLoading && <span className={s.emptyText}>Загружаем историю...</span>}

                {!isHistoryLoading && visitorSummary && visitorSummary.total_sessions > 1 && (
                  <div className={s.historySummary}>
                    <div className={s.historySummaryRow}>
                      <span>Всего обращений:</span>
                      <strong>{visitorSummary.total_sessions}</strong>
                    </div>
                    <div className={s.historySummaryRow}>
                      <span>Всего сообщений:</span>
                      <strong>{visitorSummary.total_messages}</strong>
                    </div>
                    {visitorSummary.avg_rating && (
                      <div className={s.historySummaryRow}>
                        <span>Средняя оценка:</span>
                        <strong>⭐ {visitorSummary.avg_rating}</strong>
                      </div>
                    )}
                  </div>
                )}

                {!isHistoryLoading && visitorHistory && (
                  <SessionHistoryList
                    sessions={visitorHistory.sessions}
                    currentSessionId={activeSession?.id ?? ""}
                  />
                )}
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="Метрики">
              <div className={s.flexColTight}>
                <MetricRow icon={<Bot style={{ width: 15, height: 15 }} />} label="AI сообщений" value={activeSession.ai_messages_count ?? 0} />
                <MetricRow icon={<UserCheck style={{ width: 15, height: 15 }} />} label="Операторских" value={activeSession.operator_messages_count ?? 0} />
                <MetricRow icon={<Clock style={{ width: 15, height: 15 }} />} label="Время на сайте" value={`${activeSession.time_on_site ?? 0} сек`} />
                <MetricRow icon={<MessageCircle style={{ width: 15, height: 15 }} />} label="Всего сообщений" value={activeSession.messages_count ?? 0} />
                <MetricRow icon={<Clock style={{ width: 15, height: 15 }} />} label="Создан" value={formatChatTime(activeSession.created_at)} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Теги">
              <div className={s.card}>
                <div className={s.tagList}>
                  {isTagsLoading && <span className={s.emptyText}>Загружаем теги...</span>}
                  {!isTagsLoading && sessionTags.length === 0 && (
                    <span className={s.emptyText}>У диалога пока нет тегов</span>
                  )}
                  {sessionTags.map((item) => {
                    if (!item.tag) return null;
                    return (
                      <div
                        key={item.id}
                        className={s.tagPill}
                        style={{
                          background: `${item.tag.color}16`,
                          color: item.tag.color,
                          border: `1px solid ${item.tag.color}30`,
                        }}
                      >
                        <span>{item.tag.name}</span>
                        <button
                          type="button"
                          className={s.tagRemove}
                          style={{ color: item.tag.color }}
                          onClick={() => void detachSessionTag(item.tag_id)}
                        >
                          <X style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {/* Create new tag */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="Новый тег, например VIP"
                      className={s.tagInput}
                    />
                    <button
                      type="button"
                      className={`${s.smallBtn} ${s.smallBtnAccent}`}
                      onClick={() => {
                        if (!newTagName.trim()) return;
                        void createTagAndAttach(newTagName, "#7C5CBF");
                        setNewTagName("");
                      }}
                    >
                      Создать
                    </button>
                  </div>

                  {/* Attach existing tag — Radix Select */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Select
                      value={selectedExistingTagId}
                      onChange={setSelectedExistingTagId}
                      options={tagOptions}
                      placeholder="Выбрать тег"
                      className={s.tagInput}
                    />
                    <button
                      type="button"
                      className={`${s.smallBtn} ${s.smallBtnDefault}`}
                      onClick={() => {
                        if (!selectedExistingTagId) return;
                        void attachExistingTag(selectedExistingTagId);
                        setSelectedExistingTagId("");
                      }}
                    >
                      Добавить
                    </button>
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Горячие клавиши" defaultOpen={false}>
              <div className={s.card} style={{ display: "grid", gap: 6 }}>
                {[
                  ["Alt + ↑ / ↓", "Переключить чат"],
                  ["Alt + A", "Забрать чат"],
                  ["Alt + W", "Закрыть диалог"],
                  ["Alt + R", "Прочитано"],
                  ["Esc", "Сбросить поиск"],
                  ["Enter", "Найти сообщения"],
                ].map(([keys, desc]) => (
                  <div key={keys} className={s.hotkeyRow}>
                    <kbd className={s.hotkeyKbd}>{keys}</kbd>
                    <span className={s.hotkeyDesc}>{desc}</span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        </Tabs.Content>

        {/* ═══ TAB: Заметки ═══ */}
        <Tabs.Content value="notes">
          <div className={`${s.card} ${s.cardOverflow}`}>
            <div style={{ padding: 12, borderBottom: "1px solid var(--border-subtle)" }}>
              <textarea
                value={noteValue}
                onChange={(e) => setNoteValue(e.target.value)}
                placeholder="Добавить внутреннюю заметку по клиенту..."
                className={s.noteTextarea}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button
                  type="button"
                  className={`${s.smallBtn} ${s.smallBtnAccent}`}
                  onClick={() => {
                    if (!noteValue.trim()) return;
                    void createNote(noteValue);
                    setNoteValue("");
                  }}
                >
                  <Plus style={{ width: 14, height: 14 }} />
                  Добавить
                </button>
              </div>
            </div>

            <div className="scrollbar-thin" style={{ maxHeight: 400, overflowY: "auto", padding: 10 }}>
              {isNotesLoading && <div className={s.emptyText} style={{ padding: "8px 4px" }}>Загружаем заметки...</div>}
              {!isNotesLoading && notes.length === 0 && (
                <div className={s.emptyText} style={{ padding: "8px 4px" }}>Пока нет заметок</div>
              )}

              <div style={{ display: "grid", gap: 8 }}>
                {notes.map((note) => {
                  const isEditing = editingNoteId === note.id;

                  return (
                    <div key={note.id} className={s.noteCard}>
                      {isEditing ? (
                        <>
                          <textarea
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            className={s.noteTextarea}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => { setEditingNoteId(null); setEditingValue(""); }}
                            >
                              Отмена
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                void updateNote(note.id, editingValue);
                                setEditingNoteId(null);
                                setEditingValue("");
                              }}
                            >
                              Сохранить
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={s.noteText}>{note.note}</div>
                          <div className={s.noteFooter}>
                            <div className={s.noteTime}>{formatChatTime(note.updated_at)}</div>
                            <div className={s.noteActions}>
                              <button
                                type="button"
                                className={s.noteBtn}
                                onClick={() => { setEditingNoteId(note.id); setEditingValue(note.note); }}
                              >
                                <Pencil style={{ width: 14, height: 14 }} />
                              </button>
                              <button
                                type="button"
                                className={`${s.noteBtn} ${s.noteBtnDanger}`}
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: "Удалить заметку?",
                                    message: "Заметка будет удалена без возможности восстановления.",
                                    confirmText: "Удалить",
                                    cancelText: "Отмена",
                                    danger: true,
                                  });
                                  if (ok) void deleteNote(note.id);
                                }}
                              >
                                <Trash2 style={{ width: 14, height: 14 }} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* ═══ TAB: Действия ═══ */}
        <Tabs.Content value="actions">
          <div className={s.flexCol}>
            {/* Transfer */}
            <CollapsibleSection title="Передача чата">
              <div className={s.card}>
                <div className={s.emptyText} style={{ marginBottom: 10 }}>
                  Переназначить диалог на другого оператора
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Select
                    value={selectedTransferOperatorId}
                    onChange={setSelectedTransferOperatorId}
                    options={operatorOptions}
                    placeholder={isOperatorsLoading ? "Загружаем..." : "Выбрать оператора"}
                  />
                  <button
                    type="button"
                    className={`${s.smallBtn} ${s.smallBtnInfo}`}
                    onClick={() => {
                      if (!selectedTransferOperatorId) return;
                      void transferActiveSession(selectedTransferOperatorId);
                      setSelectedTransferOperatorId("");
                    }}
                  >
                    <ArrowRightLeft style={{ width: 14, height: 14 }} />
                    Передать
                  </button>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Приоритет">
              <div className={s.card}>
                <div className={s.priorityRow}>
                  <div className={s.priorityIndicator}>
                    {activeSession.priority === "urgent" && <span className={s.priorityDotUrgent} />}
                    {activeSession.priority === "high" && <span className={s.priorityDotHigh} />}
                    {activeSession.priority === "normal" && <span className={s.priorityDotNormal} />}
                    {activeSession.priority === "low" && <span className={s.priorityDotLow} />}
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {activeSession.priority === "urgent" ? "Срочный" :
                       activeSession.priority === "high" ? "Высокий" :
                       activeSession.priority === "low" ? "Низкий" : "Обычный"}
                    </span>
                    {activeSession.is_vip && <span className={s.vipMini}>VIP</span>}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Select
                    value={selectedPriority}
                    onChange={setSelectedPriority}
                    options={[
                      { value: "urgent", label: "🔴 Срочный" },
                      { value: "high", label: "🟡 Высокий" },
                      { value: "normal", label: "⚪ Обычный" },
                      { value: "low", label: "⬇️ Низкий" },
                    ]}
                    placeholder="Приоритет"
                  />
                  <button
                    type="button"
                    className={`${s.smallBtn} ${s.smallBtnInfo}`}
                    onClick={async () => {
                      await setSessionPriority(activeSession.id, selectedPriority, undefined, operator?.id);
                      void useInboxStore.getState().loadSessions();
                    }}
                  >
                    <Shield style={{ width: 14, height: 14 }} />
                    Применить
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className={activeSession.is_vip ? `${s.smallBtn} ${s.smallBtnDanger}` : `${s.smallBtn} ${s.smallBtnAccent}`}
                    onClick={async () => {
                      await setSessionPriority(activeSession.id, undefined as any, !activeSession.is_vip, operator?.id);
                      void useInboxStore.getState().loadSessions();
                    }}
                  >
                    <Crown style={{ width: 14, height: 14 }} />
                    {activeSession.is_vip ? "Снять VIP" : "Пометить VIP"}
                  </button>
                </div>
              </div>
            </CollapsibleSection>

            {/* Action buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!isAssigned && (
                <button
                  type="button"
                  className={s.actionBtn}
                  style={{
                    border: "1px solid var(--accent)",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                  onClick={() => void assignActiveSession()}
                >
                  <UserCheck style={{ width: 15, height: 15 }} />
                  Забрать чат
                </button>
              )}

              {hasUnread ? (
                <button
                  type="button"
                  className={s.actionBtn}
                  style={{
                    border: "1px solid rgba(91,140,90,0.14)",
                    background: "var(--status-online-soft)",
                    color: "var(--status-online)",
                  }}
                  onClick={() => void markActiveSessionRead()}
                >
                  <CheckCheck style={{ width: 15, height: 15 }} />
                  Пометить прочитанным
                </button>
              ) : (
                <button
                  type="button"
                  className={s.actionBtn}
                  style={{
                    border: "1px solid rgba(232,150,14,0.14)",
                    background: "var(--warning-soft)",
                    color: "var(--status-away)",
                  }}
                  onClick={() => void markActiveSessionUnread()}
                >
                  <CircleDot style={{ width: 15, height: 15 }} />
                  Пометить непрочитанным
                </button>
              )}

              <button
                type="button"
                className={s.actionBtn}
                style={{
                  border: "1px solid var(--border-default)",
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                }}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Закрыть диалог?",
                    message: "Клиент не сможет продолжить переписку в этом чате.",
                    confirmText: "Закрыть",
                    cancelText: "Отмена",
                    danger: true,
                  });
                  if (ok) void closeActiveSession();
                }}
              >
                <XCircle style={{ width: 15, height: 15 }} />
                Закрыть диалог
              </button>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}