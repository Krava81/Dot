import MarkdownIt from 'markdown-it';
import { sanitizeForTelegram } from './telegramHtml';

/**
 * Конвертация Markdown в MarkdownV2 (упрощенно).
 */
export const mdToTelegramMarkdown = (md: string): string => {
  if (!md) return "";

  let result = md;
  const lines = result.split('\n');
  
  const processedLines = lines.map(line => {
    line = line.replace(/^#+ (.*$)/g, '*$1*');
    line = line.replace(/\*\*(.+?)\*\*/g, '*$1*');
    line = line.replace(/__(.+?)__/g, '_$1_');
    line = line.replace(/~~(.+?)~~/g, '~$1~');
    line = line.replace(/`(.+?)`/g, '`$1`');
    line = line.replace(/```([\s\S]*?)```/g, '```\n$1\n```');
    return line;
  });

  result = processedLines.join('\n');
  return result.trim().replace(/\n{3,}/g, '\n\n');
};

/**
 * Конвертация Markdown в HTML для Telegram.
 */
export const mdToTelegramHtml = (md: string): string => {
  const mdParser = new MarkdownIt({ breaks: true, html: true, linkify: true });
  
  // Правило для спойлеров ||текст||
  mdParser.inline.ruler.before('text', 'spoiler', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7C || state.src.charCodeAt(start + 1) !== 0x7C) return false;
    const match = state.src.slice(start + 2).match(/^([\s\S]+?)\|\|/);
    if (!match) return false;
    if (!silent) {
      state.push('spoiler_open', 'tg-spoiler', 1);
      const t = state.push('text', '', 0);
      t.content = match[1];
      state.push('spoiler_close', 'tg-spoiler', -1);
    }
    state.pos += 4 + match[1].length;
    return true;
  });

  const preprocessed = md.replace(/^[ \t]+/gm, (match) => '&nbsp;'.repeat(match.length));
  const rawHtml = mdParser.render(preprocessed);
  return sanitizeForTelegram(rawHtml);
};
