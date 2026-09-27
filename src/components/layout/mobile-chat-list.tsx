import { Search, X } from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { LIST_FILTERS } from "@/features/inbox/conversation-list";
import { ConversationList } from "./conversation-list";
import s from "./MobileChatList.module.css";

/** Список диалогов на телефоне: те же группы и правила, что на компьютере. */
export function MobileChatList() {
  const filter = useInboxStore(state => state.filter);
  const setFilter = useInboxStore(state => state.setFilter);
  const query = useInboxStore(state => state.searchQuery);
  const setQuery = useInboxStore(state => state.setSearchQuery);
  return (
    <div className={s.container}>
      <div className={s.controls}>
        <label className={s.search}>
          <Search aria-hidden="true" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, телефон или текст" aria-label="Поиск по диалогам" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X /></button>}
        </label>
        <div className={s.segmented} role="tablist" aria-label="Какие диалоги показать">
          {LIST_FILTERS.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>
          ))}
        </div>
      </div>
      <div className={s.list}><ConversationList /></div>
    </div>
  );
}
