export interface ChatTag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ChatSessionTag {
  id: string;
  session_id: string;
  tag_id: string;
  created_at: string;
  tag: ChatTag | null;
}