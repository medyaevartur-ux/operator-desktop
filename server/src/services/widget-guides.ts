import type { Server } from "socket.io";
import { sendBot } from "./widget-bot/runtime.js";

// Подсказка на кнопку быстрого ответа «Как заказать?»: 4 шага с картинками и переход к тарифам.
// Шаги — по «Как это работает» на главной (apps/web/src/components/v2/howitworks.data.ts),
// картинки — миниатюры сайта через его оптимизатор (3–5 КБ вместо 100–230 КБ).
const SITE = "https://zhivaya-skazka.ru";
const thumb = (path: string) => `${SITE}/_next/image?url=${encodeURIComponent(path)}&w=128&q=75`;

export const HOW_TO_ORDER_GUIDE = {
  kind: "guide",
  guide: "how_to_order",
  title: "Как заказать книгу",
  steps: [
    { title: "Выберите тариф", text: "Нажмите «Выбрать» у подходящего тарифа или «Заказать» вверху страницы.", time: "2 минуты", image: thumb("/images/hero/pixar-art.webp") },
    { title: "Расскажите о ребёнке", text: "Координатор напишет вам в удобный мессенджер и всё уточнит.", time: "15 минут", image: thumb("/images/hero/fairy-face.webp") },
    { title: "Согласуйте макет", text: "Художник нарисует книгу по фото и пришлёт развороты на проверку.", time: "1–2 дня", image: thumb("/images/hero/fairy-art.webp") },
    { title: "Получите книгу", text: "Напечатаем и привезём в подарочной коробке в любую точку России.", time: "8–12 дней", image: thumb("/images/real/box-open.jpg") },
  ],
  note: "Некогда разбираться? Напишите здесь свой номер — оформим всё за вас.",
  buttons: [{ label: "Выбрать тариф", url: `${SITE}/#prices`, color: "primary" }],
} as const;

export const QUICK_REPLY_GUIDES = ["how_to_order"] as const;
export type QuickReplyGuide = (typeof QUICK_REPLY_GUIDES)[number];

export function sendQuickReplyGuide(io: Server, sessionId: string, guide: QuickReplyGuide) {
  // ponytail: одна подсказка; новая — ещё одна запись здесь и в QUICK_REPLY_GUIDES.
  if (guide === "how_to_order") return sendBot(io, sessionId, "Вот как заказать книгу — всего 4 шага 👇", HOW_TO_ORDER_GUIDE);
}
