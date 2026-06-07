/**
 * Детерминированное «красивое» имя и аватар для анонимного посетителя.
 *
 * Один и тот же visitor_id всегда даёт одно и то же имя/цвет — без хранения
 * состояния. Заменяет сырой visitor_id в заголовках/строках/аватарах экрана,
 * реальный id показывается мелким моноширинным саб-лейблом.
 */

const ADJECTIVES = [
  "Тихий",
  "Быстрый",
  "Светлый",
  "Смелый",
  "Дружный",
  "Ясный",
  "Лёгкий",
  "Добрый",
  "Бодрый",
  "Уютный",
  "Звёздный",
  "Морской",
  "Лесной",
  "Снежный",
  "Тёплый",
  "Янтарный",
  "Мятный",
  "Бирюзовый",
  "Жемчужный",
  "Солнечный",
];

/** Стабильный 32-битный хэш строки (FNV-1a-подобный). */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // приводим к беззнаковому
  return h >>> 0;
}

export interface FriendlyIdentity {
  /** Человекочитаемое имя, например «Гость-Тихий-07». */
  name: string;
  /** 2 буквы для аватара. */
  initials: string;
  /** Фон аватара (HSL-строка, не хардкод палитры дизайн-системы). */
  avatarBg: string;
  /** Контрастный цвет текста на аватаре. */
  avatarFg: string;
}

/**
 * Возвращает детерминированную «личность» для visitor_id.
 * Пустой/неизвестный id обрабатывается мягко.
 */
export function friendlyIdentity(visitorId: string | null | undefined): FriendlyIdentity {
  const id = (visitorId ?? "").trim() || "anon";
  const h = hashString(id);

  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const num = (h % 99) + 1; // 1..99
  const numStr = String(num).padStart(2, "0");
  const name = `Гость-${adj}-${numStr}`;

  // Инициалы из имени прилагательного для узнаваемости.
  const initials = (adj.slice(0, 1) + numStr.slice(0, 1)).toUpperCase();

  // Цвет по хэшу: насыщенный, но не кричащий. Не используем токены палитры
  // намеренно — аватары должны различаться между посетителями.
  const hue = h % 360;
  const avatarBg = `hsl(${hue} 58% 52%)`;
  const avatarFg = "#ffffff";

  return { name, initials, avatarBg, avatarFg };
}

/** Короткое имя посетителя (без аватара). */
export function friendlyName(visitorId: string | null | undefined): string {
  return friendlyIdentity(visitorId).name;
}
