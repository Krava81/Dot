import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { errorTracker } from '../utils/errorTracker';
import { DATA_DIR } from '../constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
   * ОПТИМИЗИРОВАНО ДЛЯ ПАМЯТИ: 
   * 1. Ищем пути файлов, конвертируем в Capacitor URL и стримим через fetch.
   * 2. Избегаем Filesystem.readFile и atob() для больших файлов.
   */
  private async toBlob(photo: string): Promise<Blob> {
    try {
      // 1. data: URL / blob:
      if (photo.startsWith('data:') || photo.startsWith('blob:')) {
        const res = await fetch(photo);
        return await res.blob();
      }

      let fetchUrl = photo;

      // 2. Local relative path -> convert to absolute URI
      if (photo.startsWith(DATA_DIR) || photo.startsWith('news_bot_data')) {
        const { uri } = await Filesystem.getUri({ path: photo, directory: Directory.Data });
        fetchUrl = uri;
      }

      // 3. Absolute local path -> convert to Capacitor HTTP bridge URL
      if (fetchUrl.startsWith('file://') && Capacitor.isNativePlatform()) {
        fetchUrl = Capacitor.convertFileSrc(fetchUrl);
      } else if (fetchUrl.includes('/_capacitor_file_/')) {
        if (!fetchUrl.startsWith('http') && !fetchUrl.startsWith('capacitor://')) {
           const idx = fetchUrl.indexOf('/_capacitor_file_/');
           fetchUrl = 'http://localhost' + fetchUrl.slice(idx);
        }
      }

      // 4. Try native streaming fetch via WebView 
      // This is memory-safe because it doesn't load the file as a JS string
      console.log(`[toBlob] Attempting fetch stream: ${fetchUrl.substring(0, 100)}...`);
      const streamController = new AbortController();
      const streamTimeoutId = setTimeout(() => streamController.abort(), 10000); // 10 seconds max for reading local file

      const res = await fetch(fetchUrl, { signal: streamController.signal });
      clearTimeout(streamTimeoutId);
      
      if (res.ok) {
        return await res.blob();
      }
      
      console.warn(`[toBlob] Stream fetch failed with status ${res.status}. Falling back to JS memory read...`);
    } catch (e) {
      console.warn(`[toBlob] Stream fetch threw an error:`, e);
    }

    // 5. FALLBACK: Read file as string into JS memory (high crash risk on Android, but necessary as last resort)
    try {
      let readPath = photo;
      let dir: Directory | undefined = undefined;
      
      if (photo.startsWith(DATA_DIR) || photo.startsWith('news_bot_data')) {
        readPath = photo;
        dir = Directory.Data;
      } else if (photo.startsWith('file://')) {
        readPath = photo.replace('file://', '');
      } else if (photo.includes('/_capacitor_file_/')) {
        readPath = '/' + photo.split('/_capacitor_file_/')[1];
      }
      
      const fileContent = await Filesystem.readFile({ path: readPath, directory: dir });
      // Use fetch to parse huge string in native C++ layer rather than atob() in JS layer
      const mime = getMimeByExt(readPath);
      const res = await fetch(`data:${mime};base64,${fileContent.data}`);
      return await res.blob();
    } catch (e: any) {
       console.error('[toBlob] FALLBACK failed completely:', e);
       throw new Error(`Media read failed: ${e.message}`);
    }
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
        
        const activeSignal = controller.signal;
        if (signal) signal.addEventListener('abort', () => controller.abort());

        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          body: formData,
          signal: activeSignal,
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30 sec default timeout for standard API calls

      try {
        console.log(`[Telegram] ${method}, attempt ${attempt + 1}`);

        // We MUST enforce the timeout. If an external signal is also provided, we can't easily polyfill AbortSignal.any()
        // for old Android webviews. So instead, if the timeout fires, we abort the internal controller AND we check it.
        // We will just pass the internal controller's signal to fetch. If the external signal aborts, we catch it manually.
        const activeSignal = controller.signal;

        if (signal) {
           signal.addEventListener('abort', () => controller.abort());
        }

        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: activeSignal,
        });

        clearTimeout(timeoutId);

        const data: { ok: boolean; result?: unknown; description?: string } = await response.json();
        if (!data.ok) throw new Error(data.description ?? `Telegram error ${response.status}`);
        return data.result;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const e = err instanceof Error ? err : new Error(String(err));
        lastError = e;
        errorTracker.track(e, `Telegram.call.${method}.attempt${attempt + 1}`);
        if (e.name === 'AbortError' && signal?.aborted) throw e;
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