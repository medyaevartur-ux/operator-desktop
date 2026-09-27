import { useSyncExternalStore } from "react";
const subscribeMobile = (notify: () => void) => {
  const query = window.matchMedia("(max-width: 767px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
export function useIsMobile(): boolean { return useSyncExternalStore(subscribeMobile, isMobile, () => false); }
export function isMobile(): boolean {
  // Tauri Android/iOS
  if ('__TAURI_INTERNALS__' in window) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
      return true;
    }
  }
  // Fallback: экран меньше 768px
  return window.innerWidth < 768;
}
