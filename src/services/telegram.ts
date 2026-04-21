import { Filesystem, Directory } from '@capacitor/filesystem';
import { errorTracker } from '../utils/errorTracker';
import { DATA_DIR } from '../constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Конвертирует base64 строку в Blob БЕЗ создания огромного data: URL.
 * Это предотвращает двойное выделение памяти (base64 + decode) и крэш WebView.
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function getMimeByExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/avi',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return map[ext] ?? 'image/jpeg';
}

// ─── TelegramAPI ──────────────────────────────────────────────────────────────

export class TelegramAPI {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  // ── isUploadablePhoto ────────────────────────────────────────────────────────
  private isUploadablePhoto(photo: string): boolean {
    if (typeof photo !== 'string') return false;
    return (
      photo.startsWith('data:image') ||
      photo.startsWith('data:video') ||
      photo.startsWith('blob:') ||
      photo.startsWith('content://') ||
      photo.startsWith('file://') ||
      photo.startsWith(DATA_DIR) ||          // news_bot_data/media/...
      photo.startsWith('news_bot_data') ||
      photo.includes('/_capacitor_file_/') ||
      photo.includes('capacitor://')
    );
  }

  // ── toBlob ───────────────────────────────────────────────────────────────────
  /**
   * Конвертирует любой источник изображения/видео в Blob для отправки в Telegram.
   *
   * Порядок попыток для каждого типа пути выбран так, чтобы минимизировать
   * использование памяти:
   *   1. capacitor:// — fetch() напрямую (WebView может обслуживать эти URL)
   *   2. file:// / абсолютный путь — Filesystem.readFile → base64ToBlob
   *   3. news_bot_data/... — Filesystem.readFile с Directory.Data → base64ToBlob
   *   4. data: URL — atob → base64ToBlob (без промежуточного fetch)
   *   5. http(s):// — обычный fetch
   */
  private async toBlob(photo: string): Promise<Blob> {
    // 1. data: URL (base64 уже в памяти — конвертируем напрямую)
    if (photo.startsWith('data:')) {
      const mime = photo.split(';')[0].split(':')[1] ?? 'image/jpeg';
      return base64ToBlob(photo, mime);
    }

    // 2. capacitor:// или /_capacitor_file_/ — Capacitor WebView Server
    if (photo.includes('capacitor://') || photo.includes('/_capacitor_file_/')) {
      // Нормализуем URL: убеждаемся, что он выглядит как capacitor://...
      let capacitorUrl = photo;
      if (!photo.startsWith('capacitor://') && photo.includes('/_capacitor_file_/')) {
        // Например: https://localhost/_capacitor_file_/storage/...
        const idx = photo.indexOf('/_capacitor_file_/');
        capacitorUrl = 'capacitor://localhost/_capacitor_file_' + photo.slice(idx + '/_capacitor_file_'.length);
      }

      try {
        console.log(`[toBlob] Fetching via WebView server: ${capacitorUrl.substring(0, 80)}`);
        const res = await fetch(capacitorUrl);
        if (res.ok) return res.blob();
        console.warn(`[toBlob] WebView fetch failed: ${res.status}`);
      } catch (err) {
        console.warn('[toBlob] WebView fetch error, trying Filesystem:', err);
      }

      // Запасной вариант: читаем через Filesystem по абсолютному пути
      try {
        let absPath = '';
        if (photo.includes('/_capacitor_file_/')) {
          absPath = '/' + photo.split('/_capacitor_file_/')[1];
        }
        if (absPath) {
          const fileContent = await Filesystem.readFile({ path: absPath });
          return base64ToBlob(fileContent.data as string, getMimeByExt(absPath));
        }
      } catch (err) {
        console.error('[toBlob] Filesystem fallback failed:', err);
      }
    }

    // 3. file:// URL
    if (photo.startsWith('file://')) {
      const absPath = photo.replace('file://', '');
      try {
        const fileContent = await Filesystem.readFile({ path: absPath });
        return base64ToBlob(fileContent.data as string, getMimeByExt(absPath));
      } catch (err) {
        console.warn('[toBlob] file:// Filesystem read failed, trying fetch:', err);
        const res = await fetch(photo);
        return res.blob();
      }
    }

    // 4. content:// (Android content provider)
    if (photo.startsWith('content://')) {
      const res = await fetch(photo);
      if (!res.ok) throw new Error(`content:// fetch failed: ${res.status}`);
      return res.blob();
    }

    // 5. Относительный путь из нашего хранилища (news_bot_data/media/...)
    if (photo.startsWith(DATA_DIR) || photo.startsWith('news_bot_data')) {
      try {
        const fileContent = await Filesystem.readFile({ path: photo, directory: Directory.Data });
        return base64ToBlob(fileContent.data as string, getMimeByExt(photo));
      } catch (err) {
        console.error('[toBlob] Storage read failed:', err);
        throw new Error(`Cannot read storage file: ${photo}`);
      }
    }

    // 6. http(s):// — обычный fetch
    const res = await fetch(photo);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching media`);
    return res.blob();
  }

  // ── multipartCall ────────────────────────────────────────────────────────────
  /**
   * Отправляет multipart/form-data запрос через fetch (НЕ через XHR).
   * Fetch надёжнее работает в Android WebView при медленном интернете.
   */
  private async multipartCall(
    method: string,
    formData: FormData,
    signal?: AbortSignal,
    retries = 3,
  ): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 мин

      try {
        console.log(`[Telegram] multipartCall ${method}, attempt ${attempt + 1}/${retries}`);
        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          body: formData,
          signal: signal ?? controller.signal,
        });
        clearTimeout(timeoutId);

        const data: { ok: boolean; result?: unknown; description?: string } = await response.json();
        if (!data.ok) throw new Error(data.description ?? `Telegram error (${response.status})`);
        return data.result;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const e = err instanceof Error ? err : new Error(String(err));
        lastError = e;
        errorTracker.track(e, `Telegram.multipart.${method}.attempt${attempt + 1}`);

        if (e.name === 'AbortError' && signal?.aborted) throw e; // внешняя отмена

        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('multipartCall: unknown error');
  }

  // ── call ─────────────────────────────────────────────────────────────────────
  async call(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal, retries = 3): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        console.log(`[Telegram] ${method}, attempt ${attempt + 1}`);
        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });

        const data: { ok: boolean; result?: unknown; description?: string } = await response.json();
        if (!data.ok) throw new Error(data.description ?? `Telegram error ${response.status}`);
        return data.result;
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        lastError = e;
        errorTracker.track(e, `Telegram.call.${method}.attempt${attempt + 1}`);
        if (e.name === 'AbortError') throw e;
        if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    throw lastError ?? new Error('call: unknown error');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async getMe(): Promise<unknown> {
    return this.call('getMe');
  }

  async getUpdates(offset?: number, signal?: AbortSignal): Promise<Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }>> {
    return this.call('getUpdates', { offset, timeout: 30 }, signal) as Promise<Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }>>;
  }

  async sendMessage(chatId: string | number, text: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  }

  // ── sendPhoto ────────────────────────────────────────────────────────────────
  async sendPhoto(
    chatId: string | number,
    photo: string,
    captionOrExtra?: string | Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    let caption = '';
    let extraOpts: Record<string, unknown> = extra;

    if (typeof captionOrExtra === 'string') {
      caption = captionOrExtra;
    } else if (captionOrExtra && typeof captionOrExtra === 'object') {
      const { caption: cap, ...rest } = captionOrExtra as Record<string, unknown>;
      caption = typeof cap === 'string' ? cap : '';
      extraOpts = { ...rest, ...extra };
    }

    if (this.isUploadablePhoto(photo)) {
      try {
        const blob = await this.toBlob(photo);
        const ext = blob.type.split('/')[1] ?? 'jpg';
        const fd = new FormData();
        fd.append('chat_id', String(chatId));
        fd.append('photo', blob, `photo.${ext}`);
        if (caption) fd.append('caption', caption);
        fd.append('parse_mode', String(extraOpts.parse_mode ?? 'HTML'));

        for (const [key, val] of Object.entries(extraOpts)) {
          if (key === 'parse_mode' || val == null) continue;
          fd.append(key, typeof val === 'string' ? val : JSON.stringify(val));
        }

        return this.multipartCall('sendPhoto', fd);
      } catch (err) {
        console.error('[sendPhoto] toBlob failed, falling back to URL:', err);
      }
    }

    // Запасной вариант: отправляем как URL (для http:// изображений)
    return this.call('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', ...extraOpts });
  }

  // ── sendVideo ────────────────────────────────────────────────────────────────
  async sendVideo(
    chatId: string | number,
    video: string,
    captionOrExtra?: string | Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    let caption = '';
    let extraOpts: Record<string, unknown> = extra;

    if (typeof captionOrExtra === 'string') {
      caption = captionOrExtra;
    } else if (captionOrExtra && typeof captionOrExtra === 'object') {
      const { caption: cap, ...rest } = captionOrExtra as Record<string, unknown>;
      caption = typeof cap === 'string' ? cap : '';
      extraOpts = { ...rest, ...extra };
    }

    if (this.isUploadablePhoto(video)) {
      const blob = await this.toBlob(video);
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      fd.append('video', blob, 'video.mp4');
      if (caption) fd.append('caption', caption);
      fd.append('parse_mode', String(extraOpts.parse_mode ?? 'HTML'));

      for (const [key, val] of Object.entries(extraOpts)) {
        if (key === 'parse_mode' || val == null) continue;
        fd.append(key, typeof val === 'string' ? val : JSON.stringify(val));
      }

      return this.multipartCall('sendVideo', fd);
    }

    return this.call('sendVideo', { chat_id: chatId, video, caption, parse_mode: 'HTML', ...extraOpts });
  }

  // ── sendMediaGroup ───────────────────────────────────────────────────────────
  /**
   * Отправляет группу медиафайлов.
   * Обрабатывает файлы ПОСЛЕДОВАТЕЛЬНО (не параллельно!) чтобы не перегружать память.
   */
  async sendMediaGroup(chatId: string | number, media: Array<Record<string, unknown>>): Promise<unknown> {
    const hasLocalMedia = media.some(
      item => typeof item.media === 'string' && this.isUploadablePhoto(item.media as string),
    );

    if (!hasLocalMedia) {
      return this.call('sendMediaGroup', { chat_id: chatId, media });
    }

    const fd = new FormData();
    fd.append('chat_id', String(chatId));

    // Последовательная конвертация → меньше одновременных данных в памяти
    const preparedMedia: Array<Record<string, unknown>> = [];
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      if (typeof item.media === 'string' && this.isUploadablePhoto(item.media)) {
        try {
          const blob = await this.toBlob(item.media);
          const ext = item.type === 'video' ? 'mp4' : blob.type.split('/')[1] ?? 'jpg';
          const attachName = `file${i}`;
          fd.append(attachName, blob, `${attachName}.${ext}`);
          preparedMedia.push({ ...item, media: `attach://${attachName}` });
        } catch (err) {
          console.error(`[sendMediaGroup] toBlob failed for item ${i}:`, err);
          // Пропускаем неудавшийся файл — отправим что смогли
        }
      } else {
        preparedMedia.push(item);
      }
    }

    if (preparedMedia.length === 0) throw new Error('sendMediaGroup: все файлы не удалось обработать');

    fd.append('media', JSON.stringify(preparedMedia));
    return this.multipartCall('sendMediaGroup', fd);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export const telegram = {
  createClient(token: string): TelegramAPI {
    return new TelegramAPI(token);
  },
};