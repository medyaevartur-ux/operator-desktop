export interface SiteVisitor {
  id: string;
  visitor_id: string;
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