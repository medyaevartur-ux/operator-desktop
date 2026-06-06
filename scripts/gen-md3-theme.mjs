// Генератор MD3-цветовых токенов из seed-цветов.
// Запуск: node scripts/gen-md3-theme.mjs ["#primarySeed"] ["#fairytaleSeed"]
// Пишет src/styles/md3/color.css:
//   :root                         = светлая (primary seed)
//   :root[data-theme="dark"]      = тёмная  (primary seed)
//   :root[data-theme="fairytale"] = тёплая  (fairytale seed)
import { themeFromSourceColor, argbFromHex, hexFromArgb } from "@material/material-color-utilities";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PRIMARY_SEED = process.argv[2] || "#4F5BD5";   // «Глубокий индиго»
const FAIRY_SEED = process.argv[3] || "#D97706";     // тёплый янтарь (сказочная тема)

const hex = (argb) => hexFromArgb(argb);

function buildScheme(theme, mode) {
  const s = theme.schemes[mode];
  const P = theme.palettes;
  const N = P.neutral, NV = P.neutralVariant, PR = P.primary;
  const tone = (pal, t) => hex(pal.tone(t));
  const light = mode === "light";
  return {
    primary: hex(s.primary), "on-primary": hex(s.onPrimary),
    "primary-container": hex(s.primaryContainer), "on-primary-container": hex(s.onPrimaryContainer),
    secondary: hex(s.secondary), "on-secondary": hex(s.onSecondary),
    "secondary-container": hex(s.secondaryContainer), "on-secondary-container": hex(s.onSecondaryContainer),
    tertiary: hex(s.tertiary), "on-tertiary": hex(s.onTertiary),
    "tertiary-container": hex(s.tertiaryContainer), "on-tertiary-container": hex(s.onTertiaryContainer),
    error: hex(s.error), "on-error": hex(s.onError),
    "error-container": hex(s.errorContainer), "on-error-container": hex(s.onErrorContainer),
    background: hex(s.background), "on-background": hex(s.onBackground),
    surface: light ? tone(N, 98) : tone(N, 6),
    "on-surface": light ? tone(N, 10) : tone(N, 90),
    "surface-variant": hex(s.surfaceVariant), "on-surface-variant": light ? tone(NV, 30) : tone(NV, 80),
    "surface-dim": light ? tone(N, 87) : tone(N, 6),
    "surface-bright": light ? tone(N, 98) : tone(N, 24),
    "surface-container-lowest": light ? tone(N, 100) : tone(N, 4),
    "surface-container-low": light ? tone(N, 96) : tone(N, 10),
    "surface-container": light ? tone(N, 94) : tone(N, 12),
    "surface-container-high": light ? tone(N, 92) : tone(N, 17),
    "surface-container-highest": light ? tone(N, 90) : tone(N, 22),
    outline: light ? tone(NV, 50) : tone(NV, 60),
    "outline-variant": light ? tone(NV, 80) : tone(NV, 30),
    shadow: hex(s.shadow), scrim: hex(s.scrim),
    "inverse-surface": light ? tone(N, 20) : tone(N, 90),
    "inverse-on-surface": light ? tone(N, 95) : tone(N, 20),
    "inverse-primary": light ? tone(PR, 80) : tone(PR, 40),
  };
}

const toBlock = (sel, vars) =>
  `${sel} {\n` + Object.entries(vars).map(([k, v]) => `  --md-sys-color-${k}: ${v};`).join("\n") + "\n}\n";

const primaryTheme = themeFromSourceColor(argbFromHex(PRIMARY_SEED));
const fairyTheme = themeFromSourceColor(argbFromHex(FAIRY_SEED));

const out =
  `/* СГЕНЕРИРОВАНО scripts/gen-md3-theme.mjs. Не редактировать вручную. */\n` +
  `/* primary seed: ${PRIMARY_SEED} | fairytale seed: ${FAIRY_SEED} */\n` +
  `/* Сменить вайб: node scripts/gen-md3-theme.mjs "#NEW" ["#FAIRY"] */\n\n` +
  toBlock(":root", buildScheme(primaryTheme, "light")) + "\n" +
  toBlock(':root[data-theme="dark"]', buildScheme(primaryTheme, "dark")) + "\n" +
  toBlock(':root[data-theme="fairytale"]', buildScheme(fairyTheme, "light"));

const target = "src/styles/md3/color.css";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, "utf8");
console.log(`Записано ${target}`);
console.log("light.primary =", buildScheme(primaryTheme, "light").primary, "| dark.primary =", buildScheme(primaryTheme, "dark").primary, "| fairy.primary =", buildScheme(fairyTheme, "light").primary);
