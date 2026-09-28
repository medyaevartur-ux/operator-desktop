import { CopyCheck, ExternalLink, Mail, MessageSquareText, PhoneCall } from "lucide-react";
import { Select, Toggle } from "@/components/ui";
import type { DaySchedule } from "@/features/settings/settings.api";
import { ChoiceCards, Note, Row, Section, TextField } from "./controls";
import { DAYS, TIMEZONES } from "./presets";
import type { WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

export function HoursTab({ w }: { w: WidgetEditor }) {
  const { hours, config: c } = w.draft;
  const setDay = (key: (typeof DAYS)[number]["key"], patch: Partial<DaySchedule>) =>
    w.setHours(h => ({ ...h, schedule: { ...h.schedule, [key]: { ...h.schedule[key], ...patch } } }));
  const copyMonday = () => w.setHours(h => ({
    ...h, schedule: { ...h.schedule, ...Object.fromEntries((["tue", "wed", "thu", "fri"] as const).map(key => [key, { ...h.schedule.mon }])) },
  }));
  return (
    <>
      <Section title="Рабочие часы" description="Вне этих часов виджет честно говорит, что сейчас никого нет, и предлагает оставить сообщение.">
        <Toggle label="Учитывать рабочие часы" description={hours.enabled ? undefined : "Выключено — виджет всегда работает как в рабочее время"} checked={hours.enabled} onChange={enabled => w.setHours(h => ({ ...h, enabled }))} />
        {hours.enabled && (
          <div className={s.nested}>
            <Row label="Часовой пояс">
              <Select value={hours.timezone} onChange={timezone => w.setHours(h => ({ ...h, timezone }))} options={TIMEZONES} />
            </Row>
            <div className={s.schedule}>
              {DAYS.map(day => {
                const d = hours.schedule[day.key];
                return (
                  <div key={day.key} className={s.day} data-off={!d.enabled || undefined}>
                    <span className={s.dayName}>{day.label}</span>
                    <Toggle label={d.enabled ? "Работаем" : "Выходной"} checked={d.enabled} onChange={enabled => setDay(day.key, { enabled })} />
                    <input type="time" required value={d.from} disabled={!d.enabled} aria-label={`${day.label}: с`} onChange={event => setDay(day.key, { from: event.target.value })} />
                    <span className={s.dash}>—</span>
                    <input type="time" required value={d.to} disabled={!d.enabled} aria-label={`${day.label}: до`} onChange={event => setDay(day.key, { to: event.target.value })} />
                  </div>
                );
              })}
            </div>
            <button type="button" className={s.smallButton} onClick={copyMonday}><CopyCheck aria-hidden />Как в понедельник — на все будни</button>
          </div>
        )}
      </Section>

      <Section title="Когда никого нет" description={hours.enabled ? "Вне рабочих часов." : "Сработает, когда включите рабочие часы."}>
        <ChoiceCards label="Что предложить посетителю" value={c.offline_mode} onChange={offline_mode => w.upd({ offline_mode })} options={[
          { value: "message_only", label: "Написать сообщение", hint: "Ответим, когда вернёмся", art: <MessageSquareText /> },
          { value: "email_capture", label: "Оставить почту", hint: "Короткая форма в окне", art: <Mail /> },
          { value: "callback_request", label: "Заказать звонок", hint: "Телефон и удобное время", art: <PhoneCall /> },
          { value: "redirect", label: "Страница контактов", hint: "Ссылка вместо чата", art: <ExternalLink /> },
        ]} />
        <Row label="Текст для посетителя" stack>
          <TextField label="Текст, когда никого нет" multiline rows={2} value={hours.offline_message} maxLength={500} placeholder="Сейчас мы не на связи. Оставьте сообщение — ответим утром." onChange={offline_message => w.setHours(h => ({ ...h, offline_message }))} />
        </Row>
        {c.offline_mode === "redirect" && (
          <Row label="Адрес страницы контактов" stack>
            <TextField label="Адрес страницы контактов" value={c.offline_redirect_url} maxLength={500} placeholder="https://zhivaya-skazka.ru/contacts" onChange={offline_redirect_url => w.upd({ offline_redirect_url })} />
          </Row>
        )}
      </Section>

      {w.leads.length > 0 && (
        <Section title={`Оставленные контакты · ${w.leads.length}`} description="Посетители, которые оставили почту или телефон вне рабочих часов.">
          <div className={s.leads}>
            {w.leads.slice(0, 30).map(lead => (
              <div key={lead.id} className={s.lead}>
                <strong>{lead.name || "Без имени"}</strong>
                <span>{[lead.phone, lead.email, lead.preferred_time && `удобно: ${lead.preferred_time}`].filter(Boolean).join(" · ")}</span>
                {lead.message && <p>{lead.message}</p>}
                <time>{new Date(lead.created_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            ))}
          </div>
          {w.leads.length > 30 && <Note>Показаны последние 30.</Note>}
        </Section>
      )}
    </>
  );
}
