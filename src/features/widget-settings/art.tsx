import { useId } from "react";
import type { WidgetConfig } from "@/features/settings/settings.api";
import type { StylePreset } from "./presets";

/* Схемы для выбора вариантов. Цвета — из CSS-переменных модуля (--art-*), поэтому обе темы приложения выглядят верно. */

const Page = () => (
  <>
    <rect x="1.5" y="1.5" width="69" height="45" rx="6" fill="var(--art-page)" stroke="var(--art-line)" />
    <rect x="8" y="9" width="26" height="3" rx="1.5" fill="var(--art-ink)" opacity=".5" />
    <rect x="8" y="15" width="18" height="3" rx="1.5" fill="var(--art-ink)" opacity=".3" />
  </>
);

const Bubble = ({ cx, cy }: { cx: number; cy: number }) => (
  <path d={`M${cx - 3.2} ${cy - 2.2}h6.4a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2h-3.6l-2.2 1.8v-1.8h-.6a1.2 1.2 0 0 1-1.2-1.2v-3.2a1.2 1.2 0 0 1 1.2-1.2z`} fill="var(--art-on-accent)" />
);

export function LauncherArt({ type }: { type: WidgetConfig["launcher_type"] }) {
  return (
    <svg viewBox="0 0 72 48" width="72" height="48">
      <Page />
      {type === "icon_only" && <><circle cx="58" cy="35" r="7.5" fill="var(--art-accent)" /><Bubble cx={58} cy={35} /></>}
      {type === "icon_text" && (
        <>
          <rect x="24" y="28" width="42" height="14" rx="7" fill="var(--art-accent)" />
          <circle cx="31" cy="35" r="3.4" fill="var(--art-on-accent)" />
          <rect x="37" y="33.5" width="23" height="3" rx="1.5" fill="var(--art-on-accent)" />
        </>
      )}
      {type === "text_only" && (
        <>
          <rect x="30" y="29" width="36" height="12" rx="6" fill="var(--art-accent)" />
          <rect x="37" y="33.5" width="22" height="3" rx="1.5" fill="var(--art-on-accent)" />
        </>
      )}
      {type === "card" && (
        <>
          <rect x="6" y="24" width="40" height="19" rx="4" fill="var(--art-card)" stroke="var(--art-line)" />
          <circle cx="13" cy="33.5" r="4" fill="var(--art-accent)" opacity=".8" />
          <rect x="20" y="29.5" width="21" height="3" rx="1.5" fill="var(--art-ink)" />
          <rect x="20" y="35" width="15" height="2.5" rx="1.25" fill="var(--art-ink)" opacity=".5" />
          <circle cx="58" cy="35" r="7" fill="var(--art-accent)" /><Bubble cx={58} cy={35} />
        </>
      )}
    </svg>
  );
}

/** «Как на компьютере»: та же кнопка, но на экране телефона. */
export function InheritArt() {
  return (
    <svg viewBox="0 0 72 48" width="72" height="48">
      <rect x="1.5" y="6" width="42" height="30" rx="4" fill="var(--art-page)" stroke="var(--art-line)" />
      <rect x="14" y="36" width="16" height="4" rx="1" fill="var(--art-line)" />
      <circle cx="36" cy="28" r="4" fill="var(--art-accent)" />
      <rect x="50" y="10" width="20" height="34" rx="4" fill="var(--art-page)" stroke="var(--art-line)" />
      <circle cx="63.5" cy="37" r="3.5" fill="var(--art-accent)" />
    </svg>
  );
}

export function ShapeIcon({ radius }: { radius: WidgetConfig["button_radius"] }) {
  const rx = radius === "round" ? 8 : radius === "rounded" ? 5 : 1.5;
  return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden><rect x="2" y="2" width="16" height="16" rx={rx} fill="currentColor" /></svg>;
}

export function SideIcon({ side }: { side: WidgetConfig["position"] }) {
  return (
    <svg viewBox="0 0 22 16" width="20" height="15" aria-hidden>
      <rect x="1" y="1" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx={side === "bottom-left" ? 6 : 16} cy="10.5" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function MobileModeArt({ mode }: { mode: WidgetConfig["mobile_window_mode"] }) {
  return (
    <svg viewBox="0 0 48 72" width="40" height="60">
      <rect x="7" y="1.5" width="34" height="69" rx="7" fill="var(--art-page)" stroke="var(--art-line)" />
      {mode === "fullscreen" && (
        <>
          <rect x="10" y="6" width="28" height="60" rx="3.5" fill="var(--art-card)" stroke="var(--art-line)" />
          <rect x="10" y="6" width="28" height="9" rx="3.5" fill="var(--art-accent)" />
          <rect x="13" y="21" width="15" height="4" rx="2" fill="var(--art-ink)" opacity=".5" />
          <rect x="20" y="29" width="15" height="4" rx="2" fill="var(--art-accent)" opacity=".75" />
        </>
      )}
      {mode !== "fullscreen" && <rect x="9" y="4" width="30" height="64" rx="5" fill="var(--art-ink)" opacity=".22" />}
      {mode === "bottom_sheet" && (
        <>
          <path d="M9 33a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v31a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z" fill="var(--art-card)" stroke="var(--art-line)" />
          <rect x="20" y="31" width="8" height="2" rx="1" fill="var(--art-line)" />
          <rect x="13" y="38" width="15" height="4" rx="2" fill="var(--art-ink)" opacity=".5" />
          <rect x="20" y="46" width="15" height="4" rx="2" fill="var(--art-accent)" opacity=".75" />
        </>
      )}
      {mode === "popup" && (
        <>
          <rect x="12" y="18" width="24" height="36" rx="4" fill="var(--art-card)" stroke="var(--art-line)" />
          <rect x="12" y="18" width="24" height="7" rx="3" fill="var(--art-accent)" />
          <rect x="15" y="30" width="12" height="3.5" rx="1.75" fill="var(--art-ink)" opacity=".5" />
          <rect x="20" y="37" width="13" height="3.5" rx="1.75" fill="var(--art-accent)" opacity=".75" />
        </>
      )}
    </svg>
  );
}

export function ThemeArt({ theme }: { theme: WidgetConfig["theme"] }) {
  const clip = useId().replace(/:/g, "");
  const light = "#fbfaf6", dark = "#25242a";
  return (
    <svg viewBox="0 0 64 44" width="64" height="44">
      <defs><clipPath id={clip}><rect x="2" y="2" width="60" height="40" rx="6" /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="2" y="2" width="60" height="40" fill={theme === "dark" ? dark : light} />
        {theme === "auto" && <path d="M62 2V42H2z" fill={dark} />}
        <rect x="2" y="2" width="60" height="9" fill="var(--art-accent)" />
        <rect x="8" y="17" width="24" height="6" rx="3" fill={theme === "dark" ? "#3a3842" : "#ece7dd"} />
        <rect x="30" y="28" width="26" height="6" rx="3" fill="var(--art-accent)" opacity=".85" />
      </g>
      <rect x="2" y="2" width="60" height="40" rx="6" fill="none" stroke="var(--art-line)" />
      {theme === "custom" && [0, 1, 2].map(i => <circle key={i} cx={46 + i * 6} cy={20} r="2.6" fill={["#c15f3c", "#0f766e", "#7c3aed"][i]} />)}
    </svg>
  );
}

export function PresetArt({ look }: { look: StylePreset["look"] }) {
  const id = useId().replace(/:/g, "");
  const fill = `url(#${id}-fill)`;
  return (
    <svg viewBox="0 0 100 66" width="100%" height="66" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={look.from} /><stop offset="1" stopColor={look.to ?? look.from} />
        </linearGradient>
        <clipPath id={`${id}-win`}><rect x="6" y="5" width="70" height="50" rx="7" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-win)`}>
        <rect x="6" y="5" width="70" height="50" fill={look.body} />
        <rect x="6" y="5" width="70" height="12" fill={fill} />
        <rect x="12" y="23" width="34" height="8" rx="4" fill={look.ink} />
        <rect x="36" y="36" width="34" height="8" rx="4" fill={fill} />
      </g>
      <rect x="6" y="5" width="70" height="50" rx="7" fill="none" stroke="var(--art-line)" />
      <circle cx="87" cy="55" r="8" fill={fill} />
    </svg>
  );
}
