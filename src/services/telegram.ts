import { errorTracker } from '../utils/errorTracker';
import { universalFetch } from './http';
import { Filesystem } from '@capacitor/filesystem';

export class TelegramAPI {
  private token: string;
  private baseUrl: string;
  private maxRetries = 3;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private isUploadablePhoto(photo: string) {
    return typeof photo === 'string' && (
      photo.startsWith('data:image') ||
      photo.startsWith('blob:') ||
      photo.startsWith('content://') ||
      photo.startsWith('file://') ||
      photo.includes('/_capacitor_file_/') ||
      photo.includes('capacitor://')
    );
  }

  private async toBlob(photo: string): Promise<Blob> {
    if (photo.startsWith('data:image')) {
      const response = await fetch(photo);
      return response.blob();
    }
    
    try {
      if (photo.includes('/_capacitor_file_/') || photo.includes('capacitor://') || photo.startsWith('file://')) {
        let cleanPath = photo;
        if (photo.includes('/_capacitor_file_/')) {
          cleanPath = photo.split('/_capacitor_file_/')[1];
          if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
        } else if (photo.startsWith('capacitor://localhost/_capacitor_file_/')) {
          cleanPath = photo.replace('capacitor://localhost/_capacitor_file_/', '/');
        } else if (photo.startsWith('file://')) {
          cleanPath = photo.replace('file://', '');
        }
        
        const fileContent = await Filesystem.readFile({ path: cleanPath });
        const base64Response = await fetch(`data:image/jpeg;base64,${fileContent.data}`);
        return base64Response.blob();
      }
    } catch (e) {
      console.warn("Filesystem read failed, falling back to fetch:", e);
    }

    const response = await fetch(photo);
    if (!response.ok) {
      throw new Error(`Failed to read local image: ${response.status}`);
    }
    return response.blob();
  }

  private async multipartCall(
    method: string,
    formData: FormData,
    signal?: AbortSignal,
    retries = 3
  ) {
    let lastError: any = null;
    this.maxRetries = retries;

    for (let i = 0; i < retries; i++) {
      const attempt = i + 1;
      try {
        const result = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${this.baseUrl}/${method}`, true);
          
          if (signal) {
            signal.addEventListener('abort', () => {
              xhr.abort();
              reject(new Error('AbortError'));
            });
          }

          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (!data.ok) {
                reject(new Error(data.description || `Telegram API Error: ${xhr.status}`));
              } else {
                resolve(data.result);
              }
            } catch (e) {
              reject(new Error(`Failed to parse response: ${xhr.status}`));
            }
          };

          xhr.onerror = () => {
            reject(new Error('Network error during multipart upload'));
          };

          xhr.send(formData);
        });
        
        return result;
      } catch (error: any) {
        lastError = error;
        errorTracker.track(error, `Telegram.multipart.${method}.attempt${attempt}`);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }

    throw lastError;
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
          body: body,
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
    if (this.isUploadablePhoto(photo)) {
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('photo', await this.toBlob(photo), 'photo.jpg');
      if (caption) formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');

      Object.entries(extra || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      });

      return this.multipartCall('sendPhoto', formData);
    }

    return this.call('sendPhoto', {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: 'HTML',
      ...extra
    });
  }

  async sendMediaGroup(chatId: string | number, media: any[]) {
    const hasLocalMedia = media.some((item: any) => typeof item?.media === 'string' && this.isUploadablePhoto(item.media));
    if (hasLocalMedia) {
      const formData = new FormData();
      formData.append('chat_id', String(chatId));

      const preparedMedia = await Promise.all(media.map(async (item: any, index: number) => {
        if (typeof item?.media === 'string' && this.isUploadablePhoto(item.media)) {
          const attachName = `file${index}`;
          formData.append(attachName, await this.toBlob(item.media), `${attachName}.jpg`);
          return { ...item, media: `attach://${attachName}` };
        }
        return item;
      }));

      formData.append('media', JSON.stringify(preparedMedia));
      return this.multipartCall('sendMediaGroup', formData);
    }

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
