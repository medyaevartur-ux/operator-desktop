import { useEffect, useState, useMemo } from "react";
import { getOperators, deleteOperator, updateOperator } from "@/features/operators/operators.api";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";
import type { ChatOperator } from "@/types/operator";
import {
  ArrowLeft, Plus, Search, X, Filter,
  CheckSquare, UserX,
} from "lucide-react";
import { Select, useConfirm, toast } from "@/components/ui";
import { OperatorCard } from "./OperatorCard";
import { OperatorModal } from "./OperatorModal";
import s from "./OperatorsScreen.module.css";

type StatusFilter = "all" | "online" | "away" | "dnd" | "offline";

const STATUS_COLORS: Record<string, string> = {
  online: "var(--status-online)",
  away: "var(--status-away)",
  dnd: "var(--status-dnd)",
  offline: "var(--text-disabled)",
};

const STATUS_LABELS: Record<string, string> = {
  all: "Все",
  online: "Онлайн",
  away: "Отошёл",
  dnd: "Не беспокоить",
  offline: "Офлайн",
};

const ROLE_OPTIONS = [
  { value: "all", label: "Все роли" },
  { value: "admin", label: "Админы" },
  { value: "supervisor", label: "Супервайзеры" },
  { value: "operator", label: "Операторы" },
];

export function OperatorsScreen() {
  const [operators, setOperators] = useState<ChatOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOp, setEditOp] = useState<ChatOperator | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  const currentUser = useAuthStore((st) => st.operator);
  const setScreen = useNavigationStore((st) => st.setScreen);
  const { confirm } = useConfirm();

  const load = async () => {
    setLoading(true);
    const data = await getOperators();
    setOperators(data.filter((op) => op.is_active !== false));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    let result = operators;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (op) =>
          (op.name ?? "").toLowerCase().includes(q) ||
          (op.email ?? "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((op) => op.status === statusFilter);
    }
    if (roleFilter !== "all") {
      result = result.filter((op) => op.role === roleFilter);
    }
    return result;
  }, [operators, searchQuery, statusFilter, roleFilter]);

  /* ── Stats based on FILTERED (8.8) ── */
  const stats = useMemo(() => {
    const online = filtered.filter((o) => o.status === "online").length;
    const away = filtered.filter((o) => o.status === "away").length;
    const totalChats = filtered.reduce((a, o) => a + (o.current_chats_count ?? 0), 0);
    return { online, away, total: filtered.length, totalChats };
  }, [filtered]);

  /* ── Bulk ── */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((o) => o.id)));
  };

  const bulkDeactivate = async () => {
    if (selectedIds.size === 0) return;
    if (selectedIds.has(currentUser?.id ?? "")) {
      toast.error("Нельзя деактивировать себя");
      return;
    }
    const ok = await confirm({
      title: "Деактивировать операторов?",
      message: `Будет деактивировано ${selectedIds.size} операторов. Их чаты станут неназначенными.`,
      confirmText: "Деактивировать",
      cancelText: "Отмена",
      danger: true,
    });
    if (!ok) return;
    for (const id of selectedIds) {
      await updateOperator(id, { is_active: false });
    }
    setSelectedIds(new Set());
    setBulkMode(false);
    void load();
  };

  const modalOpen = !!(editOp || isCreating);

  return (
    <div className={s.screen}>
      {/* ── Header ── */}
      <div className={s.header}>
        <button className={s.backBtn} onClick={() => setScreen("inbox")}>
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>

        <div className={s.headerInfo}>
          <h1 className={s.headerTitle}>Операторы</h1>
          <span className={s.headerSub}>
            {stats.online} онлайн · {stats.away} отошли · {stats.totalChats} активных чатов
          </span>
        </div>

        <div className={s.headerActions}>
          <button
            className={`${s.toggleBtn} ${bulkMode ? s.toggleBtnActive : s.toggleBtnDefault}`}
            onClick={() => { setBulkMode((p) => !p); setSelectedIds(new Set()); }}
          >
            <CheckSquare style={{ width: 15, height: 15 }} />
            {bulkMode ? "Отмена" : "Выбрать"}
          </button>

          <button
            className={s.addBtn}
            onClick={() => { setIsCreating(true); setEditOp(null); }}
          >
            <Plus style={{ width: 16, height: 16 }} />
            Добавить
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className={s.filters}>
        {/* Search */}
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по имени или email..."
            className={s.searchInput}
          />
          {searchQuery && (
            <button className={s.searchClear} onClick={() => setSearchQuery("")}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div className={s.statusFilters}>
          <Filter className={s.filterIcon} />
          {(["all", "online", "away", "dnd", "offline"] as StatusFilter[]).map((key) => (
            <button
              key={key}
              className={`${s.statusPill} ${statusFilter === key ? s.statusPillActive : ""}`}
              onClick={() => setStatusFilter(key)}
            >
              {key !== "all" && (
                <span
                  className={s.statusPillDot}
                  style={{ background: STATUS_COLORS[key] }}
                />
              )}
              {STATUS_LABELS[key]}
            </button>
          ))}
        </div>

        {/* Role — Radix Select */}
        <Select
          value={roleFilter}
          onChange={(v) => setRoleFilter(v)}
          options={ROLE_OPTIONS}
          placeholder="Все роли"
        />
      </div>

      {/* ── Bulk bar ── */}
      {bulkMode && selectedIds.size > 0 && (
        <div className={s.bulkBar}>
          <span>Выбрано: {selectedIds.size}</span>
          <button className={s.bulkDeactivate} onClick={() => void bulkDeactivate()}>
            <UserX style={{ width: 14, height: 14 }} />
            Деактивировать
          </button>
          <button className={s.bulkSelectAll} onClick={selectAll}>
            {selectedIds.size === filtered.length ? "Снять все" : "Выбрать все"}
          </button>
        </div>
      )}

      {/* ── List ── */}
      <div className={`${s.list} scrollbar-thin`}>
        {loading && <div className={s.emptyText}>Загрузка...</div>}

        {!loading && filtered.length === 0 && (
          <div className={s.emptyText}>
            {searchQuery || statusFilter !== "all" || roleFilter !== "all"
              ? "Ничего не найдено"
              : "Нет операторов"}
          </div>
        )}

        {filtered.map((op) => (
          <OperatorCard
            key={op.id}
            op={op}
            isSelf={op.id === currentUser?.id}
            bulkMode={bulkMode}
            isSelected={selectedIds.has(op.id)}
            onToggleSelect={() => toggleSelect(op.id)}
            onEdit={() => { setEditOp(op); setIsCreating(false); }}
            onDelete={async () => {
              if (op.id === currentUser?.id) return;
              const ok = await confirm({
                title: "Удалить оператора?",
                message: `Оператор «${op.name}» будет удалён. Все его чаты станут неназначенными.`,
                confirmText: "Удалить",
                cancelText: "Отмена",
                danger: true,
              });
              if (!ok) return;
              await deleteOperator(op.id);
              void load();
            }}
          />
        ))}
      </div>

      {/* ── Modal ── */}
      <OperatorModal
        operator={isCreating ? null : editOp}
        open={modalOpen}
        onClose={() => { setEditOp(null); setIsCreating(false); }}
        onSaved={() => {
          setEditOp(null);
          setIsCreating(false);
          void load();
          if (editOp?.id === currentUser?.id) {
            void useAuthStore.getState().checkAuth();
          }
        }}
      />
    </div>
  );
}