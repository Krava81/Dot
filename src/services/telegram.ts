import { errorTracker } from '../utils/errorTracker';
import { universalFetch } from './http';

export class TelegramAPI {
  private token: string;
  private baseUrl: string;
  private maxRetries = 3;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call(method: string, body: any = {}, signal?: AbortSignal, retries = 3) {
    let lastError: any = null;
    this.maxRetries = retries;
    
    for (let i = 0; i < retries; i++) {
      const attempt = i + 1;
      console.log(`[Telegram] Attempt ${attempt}/${this.maxRetries}`, method);
      try {
        const response = await universalFetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          body: JSON.stringify(body),
          signal
        });

        const data = await response.json();
        if (!data.ok) {
          throw new Error(data.description || `Telegram API Error: ${response.status}`);
        }
        return data.result;
      } catch (error: any) {
        lastError = error;
        errorTracker.track(error, `Telegram.call.${method}.attempt${attempt}`);
        // Wait before retry
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    
    throw lastError;
  }

  async getMe() {
    return this.call('getMe');
  }

  async sendMessage(chatId: string | number, text: string, extra: any = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extra
    });
  }

  async sendPhoto(chatId: string | number, photo: string, caption?: string, extra: any = {}) {
    return this.call('sendPhoto', {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: 'HTML',
      ...extra
    });
  }

  async sendMediaGroup(chatId: string | number, media: any[]) {
    return this.call('sendMediaGroup', {
      chat_id: chatId,
      media
    });
  }

  async getUpdates(offset?: number, signal?: AbortSignal) {
    return this.call('getUpdates', { offset, timeout: 30 }, signal);
  }
}

// Telegram API factory
export const telegram = {
  createClient(token: string): TelegramAPI {
    return new TelegramAPI(token);
  }
};
