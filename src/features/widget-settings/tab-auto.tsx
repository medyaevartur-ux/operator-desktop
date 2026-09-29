import { Plus, Trash2 } from "lucide-react";
import { Select, Toggle } from "@/components/ui";
import type { AutoMessage } from "@/features/settings/settings.api";
import { Note, NumberField, Row, Section, Segmented, TextField } from "./controls";
import { AUTO_MESSAGE_TRIGGERS } from "./presets";
import type { WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

const OFF_NOTE = "Не действует, пока выключены автоматические приглашения выше.";

export function AutoTab({ w }: { w: WidgetEditor }) {
  const c = w.draft.config;
  const on = c.auto_invite_enabled === true;
  const t = c.triggers;
  const messages = c.auto_messages ?? [];
  const setMessage = (index: number, patch: Partial<AutoMessage>) => w.upd({ auto_messages: messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
  const ab = c.ab_variants;
  return (
    <>
      <Section title="Автоматические приглашения" description="Выключено — посетитель видит только кнопку и сам решает, писать ли. Всё остальное на этой вкладке работает, только когда приглашения включены.">
        <Toggle label="Предлагать помощь автоматически" checked={on} onChange={auto_invite_enabled => w.upd({ auto_invite_enabled })} />
        {on && (
          <div className={s.nested}>
            <Row label="Пригласить через" hint="Сколько посетитель пробыл на сайте">
              <NumberField label="Пригласить через" value={c.auto_invite_delay ?? 60} min={15} max={3600} unit="сек" onChange={auto_invite_delay => w.upd({ auto_invite_delay })} />
            </Row>
            <Row label="Текст приглашения" stack>
              <TextField label="Текст приглашения" multiline rows={2} value={c.auto_invite_message ?? ""} maxLength={500} invalid={!c.auto_invite_message?.trim()} onChange={auto_invite_message => w.upd({ auto_invite_message })} />
            </Row>
            <Row label="Не предлагать после отказа" hint="Если посетитель закрыл приглашение">
              <NumberField label="Пауза после отказа" value={c.auto_invite_cooldown_hours ?? 24} min={1} max={720} unit="ч" onChange={auto_invite_cooldown_hours => w.upd({ auto_invite_cooldown_hours })} />
            </Row>
            <Note>Приглашение приходит от имени команды и только когда кто-то из вас в сети. «Не сейчас» или закрытие окна — это отказ: до конца паузы посетителю ничего не предлагаем, во всех его вкладках.</Note>
          </div>
        )}
      </Section>

      <Section title="Открыть окно само" inactive={!on} inactiveNote={OFF_NOTE}>
        <Row label="Через" hint="0 — не открывать">
          <NumberField label="Открыть окно через" value={c.auto_open_delay ?? 0} min={0} max={600} unit="сек" onChange={auto_open_delay => w.upd({ auto_open_delay })} />
        </Row>
        <Toggle label="Когда курсор уходит со страницы" description="Посетитель тянется закрыть вкладку" checked={t.exit_intent} onChange={exit_intent => w.updTriggers({ exit_intent })} />
        <Toggle label="После прокрутки страницы" checked={t.scroll_percent !== null} onChange={on => w.updTriggers({ scroll_percent: on ? 50 : null })} />
        {t.scroll_percent !== null && (
          <div className={s.nested}>
            <Row label="Прокручено"><NumberField label="Процент прокрутки" value={t.scroll_percent} min={10} max={100} unit="%" onChange={scroll_percent => w.updTriggers({ scroll_percent })} /></Row>
          </div>
        )}
        <Toggle label="После времени на странице" checked={t.time_on_page !== null} onChange={on => w.updTriggers({ time_on_page: on ? 30 : null })} />
        {t.time_on_page !== null && (
          <div className={s.nested}>
            <Row label="На странице"><NumberField label="Время на странице" value={t.time_on_page} min={1} max={600} unit="сек" onChange={time_on_page => w.updTriggers({ time_on_page })} /></Row>
          </div>
        )}
        <Toggle label="После бездействия" description="Посетитель ничего не делает на странице" checked={t.inactivity_seconds !== null} onChange={on => w.updTriggers({ inactivity_seconds: on ? 30 : null })} />
        {t.inactivity_seconds !== null && (
          <div className={s.nested}>
            <Row label="Без действий"><NumberField label="Время бездействия" value={t.inactivity_seconds} min={5} max={600} unit="сек" onChange={inactivity_seconds => w.updTriggers({ inactivity_seconds })} /></Row>
          </div>
        )}
        <Row label="На страницах" hint="Если адрес содержит одно из слов — через 1,5 секунды" stack>
          <TextField label="Страницы для автооткрытия" value={t.page_url_contains ?? ""} maxLength={500} placeholder="/checkout, /help" onChange={page_url_contains => w.updTriggers({ page_url_contains })} />
        </Row>
      </Section>

      <Section title="Подсказка на телефоне" description="Короткая надпись над кнопкой чата." inactive={!on} inactiveNote={OFF_NOTE}>
        <Toggle label="Показывать подсказку" checked={c.mobile_invitation_enabled !== false} onChange={mobile_invitation_enabled => w.upd({ mobile_invitation_enabled })} />
        {c.mobile_invitation_enabled !== false && (
          <div className={s.nested}>
            <Row label="Текст"><TextField label="Текст подсказки" value={c.mobile_invitation_text ?? ""} maxLength={60} placeholder="Нужна помощь? Нажмите!" onChange={mobile_invitation_text => w.upd({ mobile_invitation_text })} /></Row>
            <Row label="Показать через"><NumberField label="Показать подсказку через" value={c.mobile_invitation_delay ?? 5} min={0} max={600} unit="сек" onChange={mobile_invitation_delay => w.upd({ mobile_invitation_delay })} /></Row>
          </div>
        )}
      </Section>

      <Section title="Автосообщения" description="Первое сообщение от команды: посетитель видит «печатает…», потом текст. Если он ответит, сообщение станет началом диалога — вы увидите то же, что и он." inactive={!on} inactiveNote={OFF_NOTE}>
        {messages.length > 0 && (
          <Note>В срок окно откроется само и пару секунд «печатает». Открыл чат раньше — видит «печатает…» до срока, но не дольше 10 секунд. Если посетитель уже отказался от приглашений, окно само не откроется: сообщение дождётся, когда он откроет чат.</Note>
        )}
        {messages.map((message, index) => (
          <div key={message.id} className={s.item} data-off={!message.enabled || undefined}>
            <div className={s.itemHead}>
              <Toggle label={message.enabled ? "Сообщение включено" : "Сообщение выключено"} checked={message.enabled} onChange={enabled => setMessage(index, { enabled })} />
              <button type="button" className={s.iconButton} aria-label="Удалить автосообщение" onClick={() => w.upd({ auto_messages: messages.filter((_, i) => i !== index) })}><Trash2 /></button>
            </div>
            <Row label="Когда">
              <Select value={message.trigger} onChange={trigger => setMessage(index, { trigger: trigger as AutoMessage["trigger"] })} options={AUTO_MESSAGE_TRIGGERS.map(item => ({ ...item }))} />
            </Row>
            <Row label="Текст" stack>
              <TextField label="Текст автосообщения" multiline rows={2} value={message.message} maxLength={1000} placeholder="Здравствуйте! Помочь подобрать сказку для вашего ребёнка?" onChange={text => setMessage(index, { message: text })} />
            </Row>
            <div className={s.grid2}>
              <Row label={message.trigger === "after_idle" ? "После паузы" : "Через"}><NumberField label="Через сколько секунд" value={message.delay_seconds} min={0} max={300} unit="сек" onChange={delay_seconds => setMessage(index, { delay_seconds })} /></Row>
              <Row label="От имени"><TextField label="От имени" value={message.sender_name} maxLength={100} placeholder="Команда" onChange={sender_name => setMessage(index, { sender_name })} /></Row>
            </div>
            <Row label="Только на страницах" hint="Пусто — на всех" stack>
              <TextField label="Страницы автосообщения" value={message.page_filter ?? ""} maxLength={500} placeholder="/catalog, /checkout" onChange={page_filter => setMessage(index, { page_filter })} />
            </Row>
            <Toggle label="Один раз в этом браузере" description="Вернувшийся посетитель его больше не увидит, с другого устройства — увидит. Выключено — раз за каждый визит." checked={message.show_once} onChange={show_once => setMessage(index, { show_once })} />
          </div>
        ))}
        {messages.length < 20 && (
          <button type="button" className={s.addButton} onClick={() => w.upd({ auto_messages: [...messages, { id: `am_${Date.now()}`, enabled: true, trigger: "on_page", delay_seconds: 5, message: "Здравствуйте! Подсказать с выбором?", sender_name: "Команда", show_once: true }] })}>
            <Plus aria-hidden />Добавить автосообщение
          </button>
        )}
      </Section>

      <Section title="Проверка приветствий (A/B)" description="Половина посетителей видит вариант A, половина — B. Через пару недель видно, какой чаще приводит к разговору.">
        <Toggle label="Проверять два приветствия" checked={c.ab_test_enabled} onChange={ab_test_enabled => w.upd({ ab_test_enabled })} />
        {c.ab_test_enabled && (
          <div className={s.nested}>
            <div className={s.grid2}>
              {(["a", "b"] as const).map(key => (
                <div key={key} className={s.variant}>
                  <strong>Вариант {key.toUpperCase()}</strong>
                  <TextField label={`Приветствие ${key.toUpperCase()}`} multiline rows={2} value={ab[key].greeting} maxLength={1000}
                    onChange={greeting => w.upd({ ab_variants: { ...ab, [key]: { ...ab[key], greeting } } })} />
                  <Row label="Доля посетителей"><NumberField label={`Доля варианта ${key.toUpperCase()}`} value={ab[key].weight} min={0} max={100} unit="%" onChange={weight => w.upd({ ab_variants: { ...ab, [key]: { ...ab[key], weight } } })} /></Row>
                </div>
              ))}
            </div>
            <Row label="Что считаем успехом">
              <Segmented label="Метрика" value={c.ab_metric} onChange={ab_metric => w.upd({ ab_metric })}
                options={[{ value: "open_rate", label: "Открыли чат" }, { value: "message_rate", label: "Написали" }, { value: "rating", label: "Оценки" }]} />
            </Row>
            {w.abStats.length > 0 && (
              <table className={s.table}>
                <thead><tr><th>Вариант</th><th>Событие</th><th>За 30 дней</th></tr></thead>
                <tbody>{w.abStats.map((row, i) => <tr key={i}><td>{row.variant.toUpperCase()}</td><td>{row.event === "opened" ? "Открыли чат" : row.event === "messaged" ? "Написали" : row.event}</td><td>{row.count}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </Section>
    </>
  );
}
