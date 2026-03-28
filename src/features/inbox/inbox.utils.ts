export type InboxFilter = "all" | "ai" | "with_operator" | "closed";

export function formatChatTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function getSessionDisplayName(name: string | null, visitorId: string) {
  if (name?.trim()) {
    return name.trim();
  }

  return visitorId;
}

export function getSessionStatusLabel(status: string) {
  if (status === "with_operator") {
    return "С оператором";
  }

  if (status === "ai") {
    return "AI";
  }

  if (status === "closed") {
    return "Закрыт";
  }

  return status;
}

export function getSenderLabel(sender: string) {
  if (sender === "visitor") {
    return "Клиент";
  }

  if (sender === "operator") {
    return "Оператор";
  }

  if (sender === "ai") {
    return "AI";
  }

  if (sender === "system") {
    return "Система";
  }

  return sender;
}