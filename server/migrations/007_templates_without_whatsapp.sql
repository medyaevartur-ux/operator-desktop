-- По просьбе владельца (03.11.2026): WhatsApp клиентам больше не предлагаем. Только chat_v8_templates.
-- Меняет шаблон, только если его текст остался ровно таким, как его вставила 006: правку в приложении не трогаем.
UPDATE chat_v8_templates SET updated_at = now(), revision = revision + 1, body = $tpl$Если вам удобнее в мессенджере — напишите нам, ответим там 😊

Telegram: https://t.me/jivaya_skazka
MAX: https://max.ru/u/f9LHodD0cOLON76f9D71fs93QCwuU58kn05IwTExjxLGij5r5ZwZCrwg83M

Или просто оставьте здесь свой номер телефона — мы сами вам напишем.$tpl$
WHERE shortcut = '/связь' AND body = $tpl$Если вам удобнее в мессенджере — напишите нам, ответим там 😊

WhatsApp: https://wa.me/79953523534
Telegram: https://t.me/jivaya_skazka
MAX: https://max.ru/u/f9LHodD0cOLON76f9D71fs93QCwuU58kn05IwTExjxLGij5r5ZwZCrwg83M

Или просто оставьте здесь свой номер телефона — мы сами вам напишем.$tpl$;
UPDATE chat_v8_templates SET updated_at = now(), revision = revision + 1, body = $tpl$Спасибо! Записали ваш номер — совсем скоро напишем вам в Telegram или MAX 😊$tpl$
WHERE shortcut = '/номер' AND body = $tpl$Спасибо! Записали ваш номер — совсем скоро напишем вам в WhatsApp или Telegram 😊$tpl$;
