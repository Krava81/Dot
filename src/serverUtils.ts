import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
/**
 * Логгер ошибок в файл
 */
export class FileLogger {
  private logFile: string;
  
  constructor(logDir: string = './logs') {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, 'app.log');
  }
  
  log(level: 'ERROR' | 'WARN' | 'INFO', message: string) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(this.logFile, line);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. УЛУЧШЕННАЯ САНИТИЗАЦИЯ HTML
// ════════════════════════════════════════════════════════════════════════════

/**
 * Безопасная санитизация HTML для Telegram
 * Поддерживает только разрешенные теги и корректно экранирует спецсимволы
 */
const sanitizeHtml = (text: string): string => {
  if (!text || typeof text !== 'string') return "";
  
  try {
    // 1. Заменяем служебные HTML-элементы на переносы строк
    let s = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/gi, " ")
      .replace(/<\/?(div|p)>/gi, "\n")
      .replace(/\r\n/g, "\n")  // Нормализуем переносы
      .replace(/\n{3,}/g, "\n\n"); // Убираем лишние переносы

    // 2. Определяем разрешенные теги для Telegram
    const allowedTags = [
      'b', 'strong',      // Жирный
      'i', 'em',          // Курсив
      'u', 'ins',         // Подчеркнутый
      's', 'strike', 'del', // Зачеркнутый
      'code',             // Моноширинный
      'pre',              // Предформатированный
      'a',                // Ссылка
      'tg-spoiler'        // Спойлер (Telegram-специфичный)
    ];
    
    // 3. Сохраняем разрешенные теги во временные плейсхолдеры
    const placeholders: { tag: string; placeholder: string }[] = [];
    const allowedTagsRegex = new RegExp(
      `<(/?)(${allowedTags.join('|')})(\\b[^>]*)?>`, 
      'gi'
    );
    
    s = s.replace(allowedTagsRegex, (match) => {
      const placeholder = `__TAG_${placeholders.length}__`;
      placeholders.push({ tag: match, placeholder });
      return placeholder;
    });

    // 4. Экранируем все оставшиеся спецсимволы
    s = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // 5. Возвращаем разрешенные теги и экранируем & в их атрибутах
    placeholders.forEach(({ tag, placeholder }) => {
      // Обрабатываем атрибуты тега (особенно href у ссылок)
      const processedTag = tag.replace(/href="([^"]*)"/gi, (match, url) => {
        // Экранируем & в URL (но не &amp;, &lt;, &gt; и т.д.)
        const safeUrl = url.replace(/&(?![a-zA-Z0-9#]+;)/g, "&amp;");
        return `href="${safeUrl}"`;
      });
      
      s = s.replace(placeholder, processedTag);
    });

    // 6. Удаляем запрещенные HTML-теги
    s = s.replace(/<\/?(html|body|head|meta|title|doctype|script|style)[^>]*>/gi, "");

    // 7. Финальная валидация через cheerio
    try {
      const $ = load(s, null, false);
      s = $.html();
    } catch (cheerioError) {
      console.warn('Cheerio validation warning:', cheerioError);
      // Продолжаем с текущей версией, если cheerio упал
    }

    // 8. Финальная очистка
    s = s
      .trim()
      .replace(/\n{3,}/g, "\n\n") // Убираем множественные переносы
      .replace(/\s+$/gm, ''); // Убираем ТОЛЬКО пробелы в конце строк, сохраняя отступы в начале
    
    return s;
    
  } catch (error) {
    console.error('❌ HTML sanitization fatal error:', error);
    
    // ✅ Fallback: Если санитизация полностью упала, возвращаем чистый текст
    return text
      .replace(/<[^>]*>/g, '')  // Удаляем все теги
      .replace(/&[a-zA-Z0-9#]+;/g, (match) => {
        // Декодируем основные HTML entities
        const entities: Record<string, string> = {
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&#39;': "'",
          '&nbsp;': ' '
        };
        return entities[match] || match;
      })
      .trim();
  }
};

// ════════════════════════════════════════════════════════════════════════════
// 2. МЕНЕДЖЕР ЛОГОВ С ОПТИМИЗАЦИЕЙ
// ════════════════════════════════════════════════════════════════════════════

/**
 * Эффективный менеджер логов с кольцевым буфером
 */
class LogManager {
  private logs: string[];
  private readonly maxLogs: number;
  private logClients: Set<any>; // Changed to any to match Response type in Express
  private writePointer: number;

  constructor(maxLogs: number = 200) {
    this.logs = new Array(maxLogs);
    this.maxLogs = maxLogs;
    this.logClients = new Set();
    this.writePointer = 0;
  }

  /**
   * Добавить лог (O(1) операция)
   */
  addLog(msg: string): void {
    const timestamp = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const line = `[${timestamp}] ${msg}`;
    
    // ✅ Кольцевой буфер - всегда O(1)
    this.logs[this.writePointer] = line;
    this.writePointer = (this.writePointer + 1) % this.maxLogs;
    
    // Логируем в консоль
    console.log(line);
    
    // Отправляем клиентам через SSE
    this.broadcastToClients(line);
  }

  /**
   * Отправить лог всем подключенным SSE-клиентам
   */
  private broadcastToClients(line: string): void {
    const deadClients: any[] = [];
    
    this.logClients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(line)}\n\n`);
      } catch (error) {
        // Клиент отключился
        deadClients.push(client);
      }
    });
    
    // Удаляем мертвые подключения
    deadClients.forEach(client => this.logClients.delete(client));
    
    if (deadClients.length > 0) {
      console.log(`🧹 Removed ${deadClients.length} dead log clients`);
    }
  }

  /**
   * Добавить SSE-клиента
   */
  addClient(res: any): void {
    this.logClients.add(res);
    console.log(`📡 New log client connected (total: ${this.logClients.size})`);
  }

  /**
   * Удалить SSE-клиента
   */
  removeClient(res: any): void {
    const deleted = this.logClients.delete(res);
    if (deleted) {
      console.log(`👋 Log client disconnected (remaining: ${this.logClients.size})`);
    }
  }

  /**
   * Получить все логи (упорядоченные от новых к старым)
   */
  getLogs(): string[] {
    // ✅ Возвращаем логи в правильном порядке (от новых к старым)
    const result: string[] = [];
    
    // Читаем от writePointer-1 до 0 (новые логи)
    for (let i = this.writePointer - 1; i >= 0; i--) {
      if (this.logs[i]) result.push(this.logs[i]);
    }
    
    // Затем от maxLogs-1 до writePointer (старые логи)
    for (let i = this.maxLogs - 1; i >= this.writePointer; i--) {
      if (this.logs[i]) result.push(this.logs[i]);
    }
    
    return result;
  }

  /**
   * Очистить все логи
   */
  clear(): void {
    this.logs = new Array(this.maxLogs);
    this.writePointer = 0;
    console.log('🧹 Logs cleared');
  }

  /**
   * Получить статистику
   */
  getStats(): { totalLogs: number; activeClients: number } {
    const totalLogs = this.logs.filter(Boolean).length;
    return {
      totalLogs,
      activeClients: this.logClients.size
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. ДОПОЛНИТЕЛЬНЫЕ УТИЛИТЫ
// ════════════════════════════════════════════════════════════════════════════

/**
 * Валидация Chat ID для Telegram
 */
const validateChatId = (chatId: string | number): boolean => {
  const id = String(chatId).trim();
  
  // Число (может быть отрицательным для групп/каналов)
  if (/^-?\d+$/.test(id)) return true;
  
  // Username (@example)
  if (/^@[a-zA-Z0-9_]{5,32}$/.test(id)) return true;
  
  return false;
};

/**
 * Безопасное парсинг JSON с fallback
 */
const safeJsonParse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

/**
 * Ограничение длины строки с умным обрезанием
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  
  // Обрезаем по границе слова
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '…';
  }
  
  return truncated + '…';
};

// ✅ ЭКСПОРТ
export {
  sanitizeHtml,
  LogManager,
  validateChatId,
  safeJsonParse,
  truncateText
};
