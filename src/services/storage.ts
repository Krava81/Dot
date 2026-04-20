import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { DATA_DIR } from '../constants';

const isNative = Capacitor.isNativePlatform();

/**
 * Унифицированный интерфейс хранилища для Web и Native (Android).
 */
export const storage = {
  /**
   * Инициализация хранилища (создание папок на Native).
   */
  async init() {
    if (!isNative) return;
    try {
      await Filesystem.mkdir({
        path: DATA_DIR,
        directory: Directory.Data,
        recursive: true,
      });
      console.log(`[Storage] Directory ${DATA_DIR} initialized in Directory.Data`);
    } catch (e) {
      // Already exists or other error
    }
  },

  /**
   * Сохранить JSON в файл или localStorage.
   */
  async saveJson(filename: string, data: any) {
    if (isNative) {
      try {
        await this.init(); 
        const path = `${DATA_DIR}/${filename}`;
        await Filesystem.writeFile({
          path,
          data: JSON.stringify(data, null, 2),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        console.log(`[Storage] Saved JSON to ${path}`);
      } catch (e) {
        console.error(`[Storage] Failed to save JSON ${filename}:`, e);
      }
    } else {
      localStorage.setItem(`standalone_${filename}`, JSON.stringify(data));
      console.log(`[Storage] Saved JSON ${filename} to localStorage`);
    }
  },

  /**
   * Сохранить медиа-файл.
   */
  async saveMedia(filename: string, base64Data: string): Promise<string> {
    if (!isNative) return base64Data;
    try {
      await this.init();
      const mediaDir = `${DATA_DIR}/media`;
      try {
        await Filesystem.mkdir({ path: mediaDir, directory: Directory.Data, recursive: true });
      } catch {}
      
      const path = `${mediaDir}/${filename}`;
      const cleanData = base64Data.includes('base64,') ? base64Data.split('base64,')[1] : base64Data;
      
      await Filesystem.writeFile({
        path,
        data: cleanData,
        directory: Directory.Data
      });
      console.log(`[Storage] Saved media to ${path}`);
      return path;
    } catch (e) {
      console.error(`[Storage] Failed to save media:`, e);
      return base64Data;
    }
  },

  /**
   * Загрузить медиа-файл как base64.
   */
  async loadMedia(path: string): Promise<string> {
    if (!isNative || !path.includes('/')) return path;
    try {
      const result = await Filesystem.readFile({
        path,
        directory: Directory.Data
      });
      
      const ext = path.split('.').pop()?.toLowerCase();
      let mime = 'image/jpeg';
      if (ext === 'png') mime = 'image/png';
      else if (ext === 'gif') mime = 'image/gif';
      else if (ext === 'mp4') mime = 'video/mp4';
      else if (ext === 'mov') mime = 'video/quicktime';
      
      const dataLength = (typeof result.data === 'string') ? result.data.length : 0;
      console.log(`[Storage] Loaded media from ${path}, size: ${dataLength}`);
      return `data:${mime};base64,${result.data}`;
    } catch (e) {
      console.error(`[Storage] Failed to load media ${path}:`, e);
      return path;
    }
  },

  /**
   * Загрузить JSON из файла или localStorage.
   */
  async loadJson(filename: string, defaultValue: any = []) {
    try {
      if (isNative) {
        const path = `${DATA_DIR}/${filename}`;
        const result = await Filesystem.readFile({
          path,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        console.log(`[Storage] Loaded JSON from ${path}`);
        return JSON.parse(result.data as string);
      } else {
        const data = localStorage.getItem(`standalone_${filename}`);
        console.log(`[Storage] Loaded JSON ${filename} from localStorage`);
        return data ? JSON.parse(data) : defaultValue;
      }
    } catch (e) {
      return defaultValue;
    }
  },

  /**
   * Сохранить настройку.
   */
  async setSetting(key: string, value: string) {
    if (isNative) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(`setting_${key}`, value);
    }
  },

  /**
   * Получить настройку.
   */
  async getSetting(key: string) {
    if (isNative) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(`setting_${key}`);
    }
  },

  /**
   * Безопасное сохранение токенов/ключей.
   */
  async setSecure(key: string, value: string) {
    const prefixedKey = `secure_${key}`;
    if (isNative) {
      await Preferences.set({ key: prefixedKey, value });
    } else {
      localStorage.setItem(prefixedKey, value);
    }
  },

  /**
   * Получение защищенных данных.
   */
  async getSecure(key: string) {
    const prefixedKey = `secure_${key}`;
    if (isNative) {
      const { value } = await Preferences.get({ key: prefixedKey });
      return value;
    } else {
      return localStorage.getItem(prefixedKey);
    }
  }
};
