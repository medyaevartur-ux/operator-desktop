function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/** Номер приглушённого тона аватара 0..7 (цвета заданы в Avatar.module.css для обеих тем). */
export function getAvatarTone(name: string): number {
  return hashString(name) % 8;
}

/** Первые буквы слов, начинающихся с буквы: «Гость 3fa9c1» → «Г», «Анна Сергеева» → «АС». */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+/u, "")).filter(word => /^\p{L}/u.test(word));
  if (!words.length) return name.trim() ? name.trim()[0].toUpperCase() : "?";
  return words.slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

export function getSessionDisplayName(
  name: string | null | undefined,
  visitorId: string
): string {
  const trimmed = name?.trim();
  return trimmed || `Гость ${visitorId.replace(/[^\p{L}\p{N}]/gu, "").slice(-6)}`;
}
