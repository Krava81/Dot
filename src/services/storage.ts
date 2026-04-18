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
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {
      // Папка уже может существовать
    }
  },

  /**
   * Сохранить JSON в файл или localStorage.
   */
  async saveJson(filename: string, data: any) {
    if (isNative) {
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: JSON.stringify(data, null, 2),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
    } else {
      localStorage.setItem(`standalone_${filename}`, JSON.stringify(data));
    }
  },

  /**
   * Загрузить JSON из файла или localStorage.
   */
  async loadJson(filename: string, defaultValue: any = []) {
    try {
      if (isNative) {
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(result.data as string);
      } else {
        const data = localStorage.getItem(`standalone_${filename}`);
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
