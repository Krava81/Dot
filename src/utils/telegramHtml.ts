/**
 * Очистка и подготовка HTML для Telegram API.
 */
export const sanitizeForTelegram = (html: string): string => {
  if (!html) return "";
  
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/<\/?(div|p)[^>]*>/gi, "\n")
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n<b>$1</b>\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const allowed = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler'];
  const placeholders: { tag: string; ph: string }[] = [];
  
  // Временно заменяем разрешенные теги плейсхолдерами, чтобы не экранировать их
  s = s.replace(new RegExp(`<(/?)(${allowed.join('|')})(\\b[^>]*)?>`, 'gi'), (m) => {
    const ph = `__PH_${placeholders.length}__`;
    placeholders.push({ tag: m, ph });
    return ph;
  });

  // Экранируем спецсимволы HTML
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Возвращаем разрешенные теги обратно
  placeholders.forEach(({ tag, ph }) => {
    s = s.replace(ph, tag);
  });

  return s.trim().replace(/\n{3,}/g, "\n\n");
};
