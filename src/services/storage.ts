import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { DATA_DIR } from '../constants';

const isNative = Capacitor.isNativePlatform();

function getMimeByPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}

/**
 * Унифицированный интерфейс хранилища для Web и Native (Android).
 */
export const storage = {
  /**
   * Инициализация хранилища (создание папок на Native).
   */
  async init(): Promise<void> {
    if (!isNative) return;
    try {
      await Filesystem.mkdir({
        path: DATA_DIR,
        directory: Directory.Data,
        recursive: true,
      });
      console.log(`[Storage] Directory ${DATA_DIR} initialized`);
    } catch {
      // Уже существует — игнорируем
    }
  },

  /**
   * Сохранить JSON в файл или localStorage.
   */
  async saveJson(filename: string, data: unknown): Promise<void> {
    if (isNative) {
      try {
        await this.init();
        await Filesystem.writeFile({
          path: `${DATA_DIR}/${filename}`,
          data: JSON.stringify(data, null, 2),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        console.log(`[Storage] Saved JSON: ${DATA_DIR}/${filename}`);
      } catch (e) {
        console.error(`[Storage] Failed to save JSON ${filename}:`, e);
      }
    } else {
      localStorage.setItem(`standalone_${filename}`, JSON.stringify(data));
    }
  },

  /**
   * Загрузить JSON из файла или localStorage.
   */
  async loadJson<T = unknown>(filename: string, defaultValue: T): Promise<T> {
    try {
      if (isNative) {
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(result.data as string) as T;
      } else {
        const data = localStorage.getItem(`standalone_${filename}`);
        return data ? (JSON.parse(data) as T) : defaultValue;
      }
    } catch {
      return defaultValue;
    }
  },

  /**
   * Сохранить медиа-файл (base64) на диск.
   * Возвращает относительный путь вида "news_bot_data/media/filename".
   */
  async saveMedia(filename: string, base64Data: string): Promise<string> {
    if (!isNative) return base64Data;

    try {
      await this.init();
      const mediaDir = `${DATA_DIR}/media`;
      try {
        await Filesystem.mkdir({ path: mediaDir, directory: Directory.Data, recursive: true });
      } catch {
        // Уже существует
      }

      const path = `${mediaDir}/${filename}`;
      const cleanData = base64Data.includes('base64,') ? base64Data.split('base64,')[1] : base64Data;

      await Filesystem.writeFile({ path, data: cleanData, directory: Directory.Data });
      console.log(`[Storage] Saved media: ${path}`);
      return path; // относительный путь, Directory.Data будет использован при чтении
    } catch (e) {
      console.error('[Storage] Failed to save media:', e);
      return base64Data; // fallback — храним прямо в памяти
    }
  },

  /**
   * Загрузить медиа-файл как base64 data URL.
   *
   * Логика выбора метода чтения:
   *   - data: / blob:           → уже в памяти, возвращаем как есть
   *   - capacitor:// paths      → возвращаем URL как есть (TelegramAPI.toBlob умеет с ними работать через fetch)
   *   - file://                 → возвращаем URL как есть (toBlob обработает)
   *   - news_bot_data/...       → читаем через Filesystem с Directory.Data
   *   - всё остальное           → возвращаем как есть (http-URL итд)
   */
  async loadMedia(path: string): Promise<string> {
    if (!isNative) return path;

    // Уже готово к использованию
    if (path.startsWith('data:') || path.startsWith('blob:')) return path;

    // capacitor:// и /_capacitor_file_/ — WebView умеет их отдавать через fetch()
    // Не пытаемся читать через Filesystem с Directory.Data — это вызовет ошибку
    if (path.includes('capacitor://') || path.includes('/_capacitor_file_/')) {
      return path; // toBlob в TelegramAPI обработает через fetch()
    }

    // file:// — аналогично
    if (path.startsWith('file://')) return path;

    // Нет слеша → явно не путь к файлу
    if (!path.includes('/')) return path;

    // Относительный путь из нашего хранилища (news_bot_data/media/...)
    try {
      const result = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      });

      const mime = getMimeByPath(path);
      const dataSize = typeof result.data === 'string' ? result.data.length : 0;
      console.log(`[Storage] Loaded media: ${path} (${Math.round(dataSize / 1024)}KB base64)`);

      return `data:${mime};base64,${result.data}`;
    } catch (e) {
      console.error(`[Storage] Failed to load media ${path}:`, e);
      return path; // возвращаем оригинал — пусть toBlob попробует через fetch
    }
  },

  // ── Settings ────────────────────────────────────────────────────────────────

  async setSetting(key: string, value: string): Promise<void> {
    if (isNative) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(`setting_${key}`, value);
    }
  },

  async getSetting(key: string): Promise<string | null> {
    if (isNative) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(`setting_${key}`);
    }
  },

  async setSecure(key: string, value: string): Promise<void> {
    const prefixedKey = `secure_${key}`;
    if (isNative) {
      await Preferences.set({ key: prefixedKey, value });
    } else {
      localStorage.setItem(prefixedKey, value);
    }
  },

  async getSecure(key: string): Promise<string | null> {
    const prefixedKey = `secure_${key}`;
    if (isNative) {
      const { value } = await Preferences.get({ key: prefixedKey });
      return value;
    } else {
      return localStorage.getItem(prefixedKey);
    }
  },
};