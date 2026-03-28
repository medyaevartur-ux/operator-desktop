export type ChatSessionStatus = "ai" | "with_operator" | "closed";

export type ChatMessageSender = "visitor" | "ai" | "operator" | "system";

export type ChatMessageType = "text" | "image" | "file" | "audio";

export type ChatMessageStatus = "sent" | "delivered" | "read";

export interface ChatSession {
  id: string;
  visitor_id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  status: ChatSessionStatus | string;
  operator_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
  current_page: string | null;
  current_page_title: string | null;
  priority: "urgent" | "high" | "normal" | "low";
  is_vip: boolean;
  visit_count: number;   
  queued_at: string | null;  
  auto_replied: boolean;   
  referrer: string | null;
  city: string | null;
  country: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  pages_visited: unknown;
  time_on_site: number | null;
  messages_count: number | null;
  ai_messages_count: number | null;
  operator_messages_count: number | null;
  unread_count: number | null;
  rating: number | null;
  feedback: string | null;
  tags: unknown;
  created_at: string;
  updated_at: string;
  first_message_at: string | null;
  last_message_at: string | null;
  operator_joined_at: string | null;
  closed_at: string | null;
  rating_comment: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender: ChatMessageSender;
  operator_id?: string | null;
  message: string;
  message_type?: string | null;
  attachments?: any;
  is_read: boolean;
  status?: ChatMessageStatus;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
  ai_confidence?: number | null;
  ai_intent?: string | null;
  ai_escalate_reason?: string | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  is_internal?: boolean;
  updated_at?: string | null;
  reply_to_id?: string | null;
}