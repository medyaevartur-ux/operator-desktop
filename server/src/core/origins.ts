export function operatorOrigins(): Set<string> {
  return new Set((process.env.CORS_ORIGINS || 'https://zhivaya-skazka.ru,http://tauri.localhost,https://tauri.localhost,tauri://localhost').split(',').map(value => value.trim()).filter(Boolean));
}
export function isOperatorOrigin(origin?: string) { return !origin || operatorOrigins().has(origin); }
export function isPublicWidgetPath(path: string) { return path.startsWith('/api/widget/') || path === '/api/chat-v8/meta' || path.startsWith('/uploads/'); }
