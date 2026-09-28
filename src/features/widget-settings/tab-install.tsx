import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { Toggle, toast } from "@/components/ui";
import { getWidgetEmbedCode } from "@/features/settings/settings.api";
import { ListEditor, Note, NumberField, Row, Section } from "./controls";
import { hostOnly, type WidgetEditor } from "./use-widget-settings";
import s from "./WidgetSettings.module.css";

const MAIN_SITE = "zhivaya-skazka.ru";

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { toast.error("Не удалось скопировать", "Выделите код и скопируйте вручную."); }
  };
  return (
    <div className={s.codeBlock}>
      <pre aria-label={label}>{code}</pre>
      <button type="button" className={s.smallButton} onClick={() => void copy()}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Скопировано" : "Копировать"}</button>
    </div>
  );
}

export function InstallTab({ w }: { w: WidgetEditor }) {
  const { domains, config: c } = w.draft;
  const allowed = domains.domains.map(hostOnly);
  const mainMissing = domains.enabled && allowed.filter(Boolean).length > 0 && !allowed.some(host => host === MAIN_SITE || MAIN_SITE.endsWith(`.${host}`));
  return (
    <>
      <Section title="Код для сайта" description={`На ${MAIN_SITE} виджет уже подключён. Код нужен, только если чат понадобится на другом сайте.`}>
        <CodeBlock label="Код виджета" code={getWidgetEmbedCode(API_BASE)} />
        <ol className={s.steps}>
          <li>Скопируйте код.</li>
          <li>Вставьте его перед закрывающим тегом <code>&lt;/body&gt;</code> на всех страницах сайта.</li>
          <li>Добавьте адрес этого сайта в «Разрешённые сайты» ниже, если список включён.</li>
        </ol>
      </Section>

      <Section title="Разрешённые сайты" description="Виджет запустится только на этих адресах — чужой сайт не сможет вставить ваш чат.">
        <Toggle label="Ограничить список сайтов" checked={domains.enabled} onChange={enabled => w.setDomains(d => ({ ...d, enabled, domains: enabled && !d.domains.length ? [MAIN_SITE] : d.domains }))} />
        {domains.enabled && (
          <div className={s.nested}>
            <ListEditor label="Сайт" items={domains.domains} max={100} placeholder={MAIN_SITE} addLabel="Добавить сайт" normalize={hostOnly}
              onChange={list => w.setDomains(d => ({ ...d, domains: list }))} />
            {mainMissing && <Note tone="warn">{MAIN_SITE} нет в списке — после сохранения чат на основном сайте перестанет открываться.</Note>}
            <Note>Поддомены входят автоматически: {MAIN_SITE} разрешает и shop.{MAIN_SITE}.</Note>
          </div>
        )}
        <Row label="Лимит запросов" hint="Сколько запросов в минуту допустимо от одного посетителя">
          <NumberField label="Лимит запросов" value={domains.rate_limit} min={1} max={1000} unit="в мин" onChange={rate_limit => w.setDomains(d => ({ ...d, rate_limit }))} />
        </Row>
      </Section>

      <Section title="Узнавать вошедших покупателей" description="Если покупатель вошёл в личный кабинет, виджет сразу подставит его имя и почту — не придётся спрашивать.">
        <Toggle label="Читать данные покупателя со страницы" checked={c.identity_verification} onChange={identity_verification => w.upd({ identity_verification })} />
        {c.identity_verification && (
          <div className={s.nested}>
            <Note>Разработчику сайта: перед кодом виджета на страницах для вошедших покупателей добавьте:</Note>
            <CodeBlock label="Данные покупателя" code={`<script>\n  window.ZSConfig = { user: { id: "ID", name: "Имя", email: "почта" } };\n</script>`} />
          </div>
        )}
      </Section>
    </>
  );
}
