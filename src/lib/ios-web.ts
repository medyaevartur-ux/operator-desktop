type IosNavigator = Navigator & { standalone?: boolean };

/** iPhone или iPad (iPadOS выдаёт себя за Mac, но с сенсорным экраном). */
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** Открыто с экрана «Домой», а не во вкладке браузера: только так iPhone даёт web-уведомления. */
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as IosNavigator).standalone === true;

/**
 * Веб-версия на iPhone:
 * - растягиваемся под «чёлку» и полоску «Домой» — отступы дают env(safe-area-inset-*) в CSS;
 * - клавиатура iOS не сжимает окно, поэтому высоту приложения берём из visualViewport,
 *   иначе поле ввода уходит под клавиатуру, а шапка уезжает вверх;
 * - цвет строки состояния повторяет фон текущей темы.
 * В приложениях Windows и Android ничего не меняется.
 */
export function setupWebAppChrome() {
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const paint = () => {
    const background = getComputedStyle(document.documentElement).getPropertyValue("--surface-bg").trim();
    if (theme && background) theme.content = background;
  };
  paint();
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  if (!isIos()) return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport && !viewport.content.includes("viewport-fit")) viewport.content += ", viewport-fit=cover";
  const visual = window.visualViewport;
  if (!visual) return;
  const fit = () => {
    document.documentElement.style.setProperty("--app-height", `${Math.round(visual.height)}px`);
    // Клавиатура закрывает полоску «Домой» — отступ под неё над клавиатурой не нужен.
    document.documentElement.toggleAttribute("data-keyboard", window.innerHeight - visual.height > 120);
    if (visual.offsetTop > 0) window.scrollTo(0, 0);
  };
  visual.addEventListener("resize", fit);
  visual.addEventListener("scroll", fit);
  fit();
}
