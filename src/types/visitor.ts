export interface SiteVisitor {
  id: string;
  visitor_id: string;
  visitor_name?: string | null;
  session_count: number;
  current_page: string;
  current_page_title: string;
  referrer: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  city: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_online: boolean;
  has_chat: boolean;
  chat_session_id: string | null;
  score?: number;
  is_blocked?: boolean;
  is_vip?: boolean;
}

export interface VisitorPageEvent {
  page: string;
  title: string;
  visited_at: string;
}

/**
 * Шаг в карте пути посетителя (реферер → страницы → текущая).
 * Используется компонентом VisitorJourney и эндпоинтом /api/visitors/:id/path.
 */
export interface VisitorPathStep {
  /** URL страницы (или реферера для первого шага). */
  page: string;
  /** Заголовок страницы (может отсутствовать). */
  title?: string;
  /** Когда посетитель был на этой странице. */
  visited_at?: string;
  /** Является ли шаг реферером (точкой входа извне). */
  is_referrer?: boolean;
  /** Является ли шаг текущей страницей («сейчас здесь»). */
  is_current?: boolean;
}

/**
 * Ответ пагинируемого списка посетителей. Сервер постепенно перейдёт на этот
 * формат; пока getVisitors оборачивает «сырой» массив в { items, has_more:false }.
 */
export interface PagedVisitors {
  items: SiteVisitor[];
  has_more: boolean;
  total?: number;
  online_total?: number;
  with_chat_total?: number;
}