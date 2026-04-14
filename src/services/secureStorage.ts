import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

export class SecureStorage {
  private static readonly PREFIX = 'secure_';

  static async setToken(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      // На Android используем Preferences (encrypted on modern devices)
      await Preferences.set({
        key: `${this.PREFIX}${key}`,
        value
      });
    } else {
      // В браузере предупреждаем пользователя
      console.warn('Tokens are stored in localStorage. Use native app for better security.');
      localStorage.setItem(`${this.PREFIX}${key}`, value);
    }
  }

  static async getToken(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ 
        key: `${this.PREFIX}${key}` 
      });
      return value;
    } else {
      return localStorage.getItem(`${this.PREFIX}${key}`);
    }
  }

  static async removeToken(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: `${this.PREFIX}${key}` });
    } else {
      localStorage.removeItem(`${this.PREFIX}${key}`);
    }
  }
}
