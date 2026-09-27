/** Лёгкая разметка сообщений: ссылки, **жирный**, *курсив*, `код`.
 *  Текст остаётся узлами React: HTML и небезопасные схемы ссылок не становятся разметкой. */
export function richText(text: string) {
  return text.split(/(https?:\/\/[^\s<>]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("https://") || part.startsWith("http://")) return <a key={i} href={part} target="_blank" rel="noreferrer noopener">{part}</a>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}
