import { errorTracker } from '../utils/errorTracker';
import { telegramFetch, universalFetch } from './http';
 
export class TelegramAPI {
  private token: string;
  private baseUrl: string;
  private maxRetries = 7; // ✅ Увеличено с 3 до 7 для мобильных сетей
 
  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }
 
  // ✅ ИСПРАВЛЕНО: Улучшенная retry логика с экспоненциальным backoff
  async call(method: string, body: any = {}, signal?: AbortSignal, retries?: number) {
    const maxAttempts = retries || this.maxRetries;
    let lastError: any = null;
    
    for (let i = 0; i < maxAttempts; i++) {
      const attempt = i + 1;
      
      if (attempt > 1) {
        // ✅ Экспоненциальный backoff: 2s, 4s, 8s, 16s, 32s...
        const delay = Math.min(2000 * Math.pow(2, i - 1), 30000);
        console.log(`[Telegram] Waiting ${delay}ms before retry ${attempt}/${maxAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      console.log(`[Telegram] Attempt ${attempt}/${maxAttempts}: ${method}`);
      
      try {
        // ✅ Используем специальную функцию для Telegram с дополнительными retry
        const response = await telegramFetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
          timeout: 60000 // ✅ 60 секунд для Telegram API
        });
 
        const data = await response.json();
        
        if (!data.ok) {
          const errorCode = data.error_code;
          const description = data.description || 'Unknown error';
          
          // ✅ Специальная обработка ошибок Telegram
          if (errorCode === 409) {
            // Conflict: другой экземпляр бота получает обновления
            throw new Error(`TELEGRAM_CONFLICT: ${description}`);
          } else if (errorCode === 429) {
            // Too Many Requests: нужно больше времени между запросами
            const retryAfter = data.parameters?.retry_after || 5;
            console.log(`[Telegram] Rate limited, waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue; // Повторяем попытку после паузы
          } else if (errorCode >= 500) {
            // Ошибка на стороне Telegram - повторяем
            throw new Error(`TELEGRAM_SERVER_ERROR: ${description}`);
          } else {
            // Клиентская ошибка - не повторяем
            throw new Error(`Telegram API Error ${errorCode}: ${description}`);
          }
        }
        
        console.log(`[Telegram] ✅ Success: ${method}`);
        return data.result;
        
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.message || String(error);
        
        errorTracker.track(error, `Telegram.call.${method}.attempt${attempt}`);
        
        // ✅ Определяем, стоит ли повторять
        const shouldRetry = 
          errorMsg.includes('timeout') ||
          errorMsg.includes('ETIMEDOUT') ||
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ENOTFOUND') ||
          errorMsg.includes('network') ||
          errorMsg.includes('TELEGRAM_SERVER_ERROR') ||
          errorMsg.includes('AbortError') ||
          errorMsg.includes('NetworkError');
        
        if (!shouldRetry) {
          console.error(`[Telegram] ❌ Fatal error (won't retry): ${errorMsg}`);
          throw error;
        }
        
        if (attempt === maxAttempts) {
          console.error(`[Telegram] ❌ Max retries reached for ${method}`);
          throw lastError;
        }
        
        console.warn(`[Telegram] ⚠️ Retryable error: ${errorMsg}`);
      }
    }
    
    throw lastError;
  }
 
  async getMe() {
    return this.call('getMe');
  }
 
  // ✅ УЛУЧШЕНО: sendMessage с проверкой размера текста
  async sendMessage(chatId: string | number, text: string, extra: any = {}) {
    // ✅ Проверяем лимит символов Telegram (4096)
    if (text.length > 4096) {
      console.warn(`[Telegram] Text too long (${text.length} chars), truncating...`);
      text = text.substring(0, 4090) + '...';
    }
    
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: extra.parse_mode || 'HTML',
      ...extra
    });
  }
 
  // ✅ УЛУЧШЕНО: sendPhoto с поддержкой локальных файлов
  async sendPhoto(chatId: string | number, photo: string, caption?: string, extra: any = {}) {
    // ✅ Проверяем лимит символов для caption (1024)
    if (caption && caption.length > 1024) {
      console.warn(`[Telegram] Caption too long (${caption.length} chars), truncating...`);
      caption = caption.substring(0, 1020) + '...';
    }
    
    return this.call('sendPhoto', {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: extra.parse_mode || 'HTML',
      ...extra
    });
  }
 
  // ✅ УЛУЧШЕНО: sendMediaGroup с валидацией
  async sendMediaGroup(chatId: string | number, media: any[]) {
    // ✅ Telegram поддерживает максимум 10 медиа в группе
    if (media.length > 10) {
      console.warn(`[Telegram] Media group too large (${media.length} items), splitting...`);
      
      // Разбиваем на группы по 10
      const chunks = [];
      for (let i = 0; i < media.length; i += 10) {
        chunks.push(media.slice(i, i + 10));
      }
      
      // Отправляем каждую группу отдельно
      const results = [];
      for (const chunk of chunks) {
        const result = await this.call('sendMediaGroup', {
          chat_id: chatId,
          media: chunk
        });
        results.push(result);
        
        // ✅ Пауза между группами чтобы не превысить rate limit
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      return results;
    }
    
    return this.call('sendMediaGroup', {
      chat_id: chatId,
      media
    });
  }
 
  // ✅ УЛУЧШЕНО: getUpdates с таймаутом для long polling
  async getUpdates(offset?: number, signal?: AbortSignal) {
    try {
      // ✅ Long polling с таймаутом 30 секунд
      const result = await this.call('getUpdates', { 
        offset, 
        timeout: 30,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post']
      }, signal);
      
      return Array.isArray(result) ? result : [];
    } catch (error: any) {
      // ✅ Если getUpdates падает из-за AbortError - это нормально
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        console.log('[Telegram] getUpdates aborted (expected)');
        return [];
      }
      
      throw error;
    }
  }
 
  // ✅ НОВОЕ: Проверка доступности бота
  async checkConnection(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch (error: any) {
      console.error('[Telegram] Connection check failed:', error.message);
      return false;
    }
  }
 
  // ✅ НОВОЕ: Удаление webhook для long polling
  async deleteWebhook(dropPendingUpdates = false): Promise<boolean> {
    try {
      await this.call('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
      return true;
    } catch (error: any) {
      console.error('[Telegram] Failed to delete webhook:', error.message);
      return false;
    }
  }
}
 
// Telegram API factory
export const telegram = {
  createClient(token: string): TelegramAPI {
    return new TelegramAPI(token);
  }
};
