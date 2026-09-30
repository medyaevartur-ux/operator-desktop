const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const KNOWN_NAME = /\.(jpe?g|png|webp|gif|pdf|txt|docx|xlsx|zip)$/i;

/**
 * Файлы из буфера обмена. Скриншот часто приходит без имени или без расширения — даём ему имя
 * по типу, иначе проверка «можно прикрепить» его отбрасывала. Файл из Проводника — со своим именем.
 */
export function pastedFiles(data: Pick<DataTransfer, "files" | "items"> | null | undefined): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length) {
    for (const item of Array.from(data.items ?? [])) {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files.map((file) => KNOWN_NAME.test(file.name) || !EXTENSION[file.type]
    ? file
    : new File([file], `Снимок ${new Date().toLocaleTimeString("ru-RU").replace(/:/g, "-")}.${EXTENSION[file.type]}`, { type: file.type }));
}
