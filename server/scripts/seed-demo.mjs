// Demo data for local UI checks. Synthetic people only; refuses anything but a local codex_chat_v8_test_* database.
// Usage: CHAT_DEMO_DATABASE_URL=postgres://…@127.0.0.1:…/codex_chat_v8_test_demo node scripts/seed-demo.mjs
import pg from "pg";
import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Local-only demo login. Never reuse it anywhere else.
export const DEMO_PASSWORD = "demo-local-only-7c1e";
export const DEMO_ADMIN = "anna@demo.invalid";

const value = process.env.CHAT_DEMO_DATABASE_URL;
if (!value) throw new Error("CHAT_DEMO_DATABASE_URL is required");
const url = new URL(value);
if (!/^\/codex_chat_v8_test_[a-z0-9_]+$/.test(url.pathname) || !["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error("Demo data is allowed only in a local codex_chat_v8_test_* database");
}

// Schema: the same baseline + migrations path as the integration tests.
execFileSync(process.execPath, [fileURLToPath(new URL("./bootstrap-test-db.mjs", import.meta.url))], {
  env: { ...process.env, CHAT_TEST_DATABASE_URL: value }, stdio: "inherit",
});

const db = new pg.Client({ connectionString: value });
await db.connect();
const q = (sql, params) => db.query(sql, params);

try {
  const { rows } = await q("SELECT value FROM chat_v8_test_marker WHERE value='synthetic-only'");
  if (!rows.length) throw new Error("Missing synthetic database marker");

  await q("BEGIN");
  await q(`DELETE FROM chat_v8_deliveries; DELETE FROM chat_v8_events; DELETE FROM client_notes; DELETE FROM chat_session_tags; DELETE FROM chat_tags;
    DELETE FROM message_reactions; DELETE FROM chat_v8_files; DELETE FROM widget_offline_leads; DELETE FROM widget_scenario_states; DELETE FROM widget_chat_messages; DELETE FROM widget_chat_sessions; DELETE FROM visitor_page_views;
    DELETE FROM site_visitors; DELETE FROM proactive_invitations; DELETE FROM chat_v8_templates; DELETE FROM chat_v8_auth_sessions;
    DELETE FROM chat_v8_devices; DELETE FROM chat_v8_notification_preferences; DELETE FROM operator_activity_logs; DELETE FROM chat_operators;`);

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const op = async (name, email, role, status) => (await q(
    "INSERT INTO chat_operators(name,email,password_hash,role,status,is_online,is_active,max_concurrent_chats) VALUES($1,$2,$3,$4,$5,$6,true,6) RETURNING id",
    [name, email, hash, role, status, status !== "offline"])).rows[0].id;
  const anna = await op("Анна Сергеева", DEMO_ADMIN, "admin", "online");
  const igor = await op("Игорь Лебедев", "igor@demo.invalid", "operator", "online");
  await op("Мария Котова", "maria@demo.invalid", "supervisor", "away");

  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const visitor = async (id, page, title, city, online, minutesAgo = 0) => {
    await q(`INSERT INTO site_visitors(visitor_id,current_page,current_page_title,referrer,city,country,browser,os,language,screen_resolution,is_online,first_seen_at,last_seen_at,session_count)
      VALUES($1,$2,$3,'https://yandex.ru/','${city}','Россия','Chrome','Android','ru','412x915',$4,$5,$6,2)`, [id, page, title, online, ago(minutesAgo + 25), ago(minutesAgo)]);
    for (const [i, [path, name]] of [["/", "Главная"], ["/catalog", "Каталог сказок"], [page, title]].entries()) {
      await q("INSERT INTO visitor_page_views(visitor_id,url,title,occurred_at) VALUES($1,$2,$3,$4)", [id, "https://zhivaya-skazka.ru" + path, name, ago(minutesAgo + 20 - i * 6)]);
    }
  };

  const session = async (s) => {
    const { rows } = await q(`INSERT INTO widget_chat_sessions(visitor_id,visitor_name,visitor_email,visitor_phone,operator_id,status,unread_count,current_page,current_page_title,city,country,
        priority,is_vip,visit_count,created_at,updated_at,last_message_at,queued_at,closed_at,rating,rating_comment,operator_joined_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Россия',$11,$12,$13,$14,$15,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [s.visitor, s.name ?? null, s.email ?? null, s.phone ?? null, s.operator ?? null, s.status, s.unread ?? 0, s.page, s.title, s.city,
        s.priority ?? "normal", !!s.vip, s.visits ?? 1, ago(s.started), ago(s.messages.at(-1)[2]), s.operator ? null : ago(s.started),
        s.status === "closed" ? ago(s.messages.at(-1)[2] - 1) : null, s.rating ?? null, s.ratingComment ?? null, s.operator ? ago(s.started - 1) : null]);
    const id = rows[0].id;
    for (const [sender, text, minutes, extra = {}] of s.messages) {
      await q(`INSERT INTO widget_chat_messages(session_id,sender,operator_id,message,message_type,is_read,created_at,status,is_internal)
        VALUES($1,$2,$3,$4,'text',$5,$6,$7,$8)`,
        [id, sender, sender === "operator" ? (extra.by ?? s.operator ?? anna) : null, text, sender !== "visitor" || !s.unread, ago(minutes),
          sender === "operator" ? (extra.status ?? "read") : "sent", !!extra.internal]);
    }
    await q("UPDATE widget_chat_sessions SET messages_count=(SELECT count(*) FROM widget_chat_messages WHERE session_id=$1) WHERE id=$1", [id]);
    return id;
  };

  await visitor("demo-olga", "/tales/imennaya-skazka", "Именная сказка «Волшебный лес»", "Екатеринбург", true);
  await visitor("demo-guest", "/photo-book", "Фотокнига о семье", "Челябинск", true);
  await visitor("demo-dmitry", "/cart", "Корзина", "Тюмень", true);
  await visitor("demo-irina", "/alphabet", "Алфавит с именем", "Москва", true);
  await visitor("demo-kate", "/audio", "Аудиосказки", "Пермь", false, 40);
  await visitor("demo-sergey", "/catalog", "Каталог сказок", "Уфа", true);
  await visitor("demo-bot", "/", "Главная", "Казань", true);
  await visitor("demo-browsing", "/catalog/novye", "Новинки", "Сургут", true);

  await session({ visitor: "demo-olga", name: "Ольга Миронова", phone: "+7 912 604-18-37", status: "waiting_operator", unread: 2, page: "/tales/imennaya-skazka", title: "Именная сказка «Волшебный лес»", city: "Екатеринбург", priority: "high", started: 9, visits: 3,
    messages: [["visitor", "Здравствуйте! Хочу заказать именную сказку для дочки к дню рождения 12 октября.", 8], ["visitor", "Успеете напечатать и доставить в Екатеринбург? И можно ли добавить фото на обложку?", 7]] });
  await session({ visitor: "demo-guest", status: "waiting_operator", unread: 1, page: "/photo-book", title: "Фотокнига о семье", city: "Челябинск", started: 3,
    messages: [["visitor", "Подскажите, в фотокниге можно поменять обложку после оплаты?", 2]] });
  const dmitry = await session({ visitor: "demo-dmitry", name: "Дмитрий Орлов", email: "d.orlov@example.invalid", operator: anna, status: "with_operator", unread: 1, page: "/cart", title: "Корзина", city: "Тюмень", started: 34, visits: 2,
    messages: [["visitor", "Добрый день. Заказ 4812 — где он сейчас? Трек СДЭК не открывается.", 33], ["operator", "Здравствуйте, Дмитрий! Сейчас проверю заказ 4812.", 31], ["operator", "Проверила: посылка передана в СДЭК вчера вечером, трек активируется в течение суток. Сегодня пришлю вам рабочую ссылку.", 29, { internal: false }],
      ["operator", "Клиент уже второй раз спрашивает про трек. Если к вечеру не появится — написать в поддержку СДЭК.", 28, { internal: true }], ["visitor", "Спасибо! А можно доставку перенести на субботу?", 1]] });
  await session({ visitor: "demo-kate", name: "Екатерина Белова", operator: anna, status: "with_operator", page: "/audio", title: "Аудиосказки", city: "Пермь", started: 70,
    messages: [["visitor", "Как оформить подписку на аудиосказки для двоих детей?", 68], ["operator", "Екатерина, подписка одна на семью — в ней можно создать два профиля. Отправила инструкцию на почту.", 60, { status: "delivered" }]] });
  await session({ visitor: "demo-irina", name: "Ирина Ковалёва", operator: anna, status: "with_operator", unread: 1, vip: true, priority: "urgent", page: "/alphabet", title: "Алфавит с именем", city: "Москва", started: 18, visits: 7,
    messages: [["visitor", "Мы заказывали алфавит, в имени ошибка: «Милана» вместо «Мелана». Праздник в пятницу 🙏", 12], ["operator", "Ирина, простите за ошибку! Уже передала в печать исправленный вариант.", 10], ["visitor", "А отправите курьером? Готова доплатить.", 6]] });
  await session({ visitor: "demo-sergey", name: "Сергей Николаев", operator: igor, status: "with_operator", page: "/catalog", title: "Каталог сказок", city: "Уфа", started: 25,
    messages: [["visitor", "Есть ли сказки на башкирском языке?", 24], ["operator", "Сергей, пока нет, но записал вашу просьбу — сообщим, когда появятся.", 20, { by: igor }]] });
  await session({ visitor: "demo-bot", status: "ai", page: "/", title: "Главная", city: "Казань", started: 5,
    messages: [["visitor", "Что подарить ребёнку 5 лет?", 5], ["ai", "Посмотрите именные сказки: ребёнок становится героем истории. Хотите подобрать по интересам?", 5]] });
  await session({ visitor: "demo-natasha", name: "Наталья Воронцова", operator: anna, status: "closed", page: "/tales", title: "Сказки", city: "Самара", started: 1500, rating: 5, ratingComment: "Очень быстро помогли",
    messages: [["visitor", "Можно ли оплатить при получении?", 1490], ["operator", "Да, при доставке СДЭК доступна оплата при получении.", 1485], ["visitor", "Отлично, спасибо!", 1480]] });
  await session({ visitor: "demo-alex", name: "Алексей Климов", operator: igor, status: "closed", page: "/catalog", title: "Каталог", city: "Омск", started: 4400,
    messages: [["visitor", "Сколько идёт доставка в Омск?", 4390], ["operator", "Обычно 3–5 дней после печати.", 4380, { by: igor }]] });

  await q("INSERT INTO client_notes(session_id,operator_id,note) VALUES($1,$2,'Постоянный клиент: третий заказ. Предпочитает связь в мессенджере.')", [dmitry, anna]);
  const tag = (await q("INSERT INTO chat_tags(name,color) VALUES('Доставка','#C15F3C') RETURNING id")).rows[0].id;
  await q("INSERT INTO chat_session_tags(session_id,tag_id) VALUES($1,$2)", [dmitry, tag]);

  for (const [title, shortcut, body, uses] of [
    ["Приветствие", "/привет", "Здравствуйте, {{name}}! Меня зовут {{operator}}, помогу с заказом.", 42],
    ["Сроки изготовления", "/сроки", "Именную сказку печатаем 2–3 рабочих дня, затем доставка СДЭК: 2–6 дней в зависимости от города.", 31],
    ["Статус заказа", "/статус", "Подскажите номер заказа — проверю, на каком он этапе.", 27],
    ["Фото на обложке", "/фото", "Да, фото можно добавить на обложку: загрузите его в конструкторе книги перед оплатой.", 12],
    ["Спасибо", "/спасибо", "Спасибо, что выбрали «Живую Сказку»! Если появятся вопросы — пишите.", 18],
  ]) await q("INSERT INTO chat_v8_templates(title,shortcut,body,category,uses,updated_by) VALUES($1,$2,$3,'Общие',$4,$5)", [title, shortcut, body, uses, anna]);

  await q("COMMIT");
  console.log(`Demo data ready. Login: ${DEMO_ADMIN} (password in server/scripts/seed-demo.mjs)`);
} catch (error) {
  await q("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end();
}
