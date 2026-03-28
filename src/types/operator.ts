export interface ChatOperator {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  name: string | null;
  telegram_id: number | null;
  telegram_username: string | null;
  avatar_url: string | null;
  role: string | null;
  status: string | null;
  is_online: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  max_concurrent_chats: number | null;
  current_chats_count: number | null;
  total_chats: number | null;
  total_messages: number | null;
  avg_rating: number | null;
  avg_response_time: number | null;
  created_at: string;
  updated_at: string;
}