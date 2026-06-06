// Генератор палитры дизайн-языка «Тёплый крем + бирюза» (soft UI).
// Акценты (primary/error) из teal-seed, secondary/tertiary из тёплого tan-seed,
// поверхности/нейтрали — из тёплого нейтрального seed (кремовые).
// Запуск: node scripts/gen-md3-theme.mjs ["#teal"] ["#warm"] ["#fairy"]
import { themeFromSourceColor, argbFromHex, hexFromArgb } from "@material/material-color-utilities";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TEAL = process.argv[2] || "#1E6E6A";   // глубокая бирюза (primary)
const WARM = process.argv[3] || "#7E6A4A";   // тёплый тан/нейтраль (поверхности + secondary)
const FAIRY = process.argv[4] || "#C98A2B";  // янтарь (сказочная тема)

const hex = (argb) => hexFromArgb(argb);

function buildScheme(accent, warm, mode) {
  const a = accent.schemes[mode];
  const w = warm.schemes[mode];
  const N = warm.palettes.neutral;        // тёплые нейтрали → кремовые поверхности
  const NV = warm.palettes.neutralVariant;
  const PR = accent.palettes.primary;
  const tone = (pal, t) => hex(pal.tone(t));
  const light = mode === "light";
  return {
    // акцент — teal
    primary: hex(a.primary), "on-primary": hex(a.onPrimary),
    "primary-container": hex(a.primaryContainer), "on-primary-container": hex(a.onPrimaryContainer),
    // secondary/tertiary — тёплый тан
    secondary: hex(w.secondary), "on-secondary": hex(w.onSecondary),
    "secondary-container": hex(w.secondaryContainer), "on-secondary-container": hex(w.onSecondaryContainer),
    tertiary: hex(w.tertiary), "on-tertiary": hex(w.onTertiary),
    "tertiary-container": hex(w.tertiaryContainer), "on-tertiary-container": hex(w.onTertiaryContainer),
    // ошибки — стандарт
    error: hex(a.error), "on-error": hex(a.onError),
    "error-container": hex(a.errorContainer), "on-error-container": hex(a.onErrorContainer),
    // фон/поверхности — тёплый крем
    background: light ? tone(N, 98) : tone(N, 6),
    "on-background": light ? tone(N, 10) : tone(N, 90),
    surface: light ? tone(N, 98) : tone(N, 6),
    "on-surface": light ? tone(N, 10) : tone(N, 90),
    "surface-variant": light ? tone(NV, 90) : tone(NV, 30),
    "on-surface-variant": light ? tone(NV, 30) : tone(NV, 80),
    "surface-dim": light ? tone(N, 90) : tone(N, 6),
    "surface-bright": light ? tone(N, 99) : tone(N, 24),
    "surface-container-lowest": light ? tone(N, 100) : tone(N, 4),
    "surface-container-low": light ? tone(N, 96) : tone(N, 10),
    "surface-container": light ? tone(N, 94) : tone(N, 12),
    "surface-container-high": light ? tone(N, 92) : tone(N, 17),
    "surface-container-highest": light ? tone(N, 90) : tone(N, 22),
    outline: light ? tone(NV, 50) : tone(NV, 60),
    "outline-variant": light ? tone(NV, 80) : tone(NV, 30),
    shadow: tone(N, 0), scrim: tone(N, 0),
    "inverse-surface": light ? tone(N, 20) : tone(N, 90),
    "inverse-on-surface": light ? tone(N, 95) : tone(N, 20),
    "inverse-primary": light ? tone(PR, 80) : tone(PR, 40),
  };
}

const toBlock = (sel, vars) =>
  `${sel} {\n` + Object.entries(vars).map(([k, v]) => `  --md-sys-color-${k}: ${v};`).join("\n") + "\n}\n";

const teal = themeFromSourceColor(argbFromHex(TEAL));
const warm = themeFromSourceColor(argbFromHex(WARM));
const fairy = themeFromSourceColor(argbFromHex(FAIRY));

const out =
  `/* СГЕНЕРИРОВАНО scripts/gen-md3-theme.mjs. Не редактировать вручную. */\n` +
  `/* Дизайн-язык «Тёплый крем + бирюза». teal:${TEAL} warm:${WARM} fairy:${FAIRY} */\n\n` +
  toBlock(":root", buildScheme(teal, warm, "light")) + "\n" +
  toBlock(':root[data-theme="dark"]', buildScheme(teal, warm, "dark")) + "\n" +
  toBlock(':root[data-theme="fairytale"]', buildScheme(fairy, warm, "light"));

const target = "src/styles/md3/color.css";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, "utf8");
console.log("Записано", target);
const L = buildScheme(teal, warm, "light"), D = buildScheme(teal, warm, "dark");
console.log("light: primary", L.primary, "secondary", L.secondary, "surface", L.surface);
console.log("dark : primary", D.primary, "secondary", D.secondary, "surface", D.surface);
