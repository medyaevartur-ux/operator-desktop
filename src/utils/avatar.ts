const GRADIENTS = [
  "linear-gradient(135deg, #7C5CBF, #B07CD8)",
  "linear-gradient(135deg, #3B7DD8, #5BA3F5)",
  "linear-gradient(135deg, #5B8C5A, #7CB97B)",
  "linear-gradient(135deg, #E8960E, #F5B73D)",
  "linear-gradient(135deg, #C0392B, #E74C3C)",
  "linear-gradient(135deg, #1ABC9C, #48D1A5)",
  "linear-gradient(135deg, #E67E22, #F0A04B)",
  "linear-gradient(135deg, #8E44AD, #BB6BD9)",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function getAvatarGradient(name: string): string {
  return GRADIENTS[hashString(name) % GRADIENTS.length];
}

export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";

  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed[0].toUpperCase();
}

export function getSessionDisplayName(
  name: string | null | undefined,
  visitorId: string
): string {
  const trimmed = name?.trim();
  return trimmed || `Гость ${visitorId.slice(-6)}`;
}