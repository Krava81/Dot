import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();
const DATA_DIR = 'app_data';

export const nativeStorage = {
  async ensureDataDir() {
    if (!isNative) return;
    try {
      await Filesystem.mkdir({ path: DATA_DIR, directory: Directory.Data, recursive: true });
    } catch (e) {}
  },

  async readJsonFile<T>(filename: string, defaultValue: T): Promise<T> {
    try {
      if (isNative) {
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(result.data as string);
      } else {
        const data = localStorage.getItem(filename);
        return data ? JSON.parse(data) : defaultValue;
      }
    } catch (e) {
      return defaultValue;
    }
  },

  async writeJsonFile(filename: string, data: any): Promise<void> {
    if (isNative) {
      await this.ensureDataDir();
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: JSON.stringify(data, null, 2),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
    } else {
      localStorage.setItem(filename, JSON.stringify(data));
    }
  },

  async getToken(): Promise<string> {
    const { value } = await Preferences.get({ key: 'bot_token' });
    return value || '';
  },
  async setToken(token: string): Promise<void> {
    await Preferences.set({ key: 'bot_token', value: token });
  },
  async getChatId(): Promise<string> {
    const { value } = await Preferences.get({ key: 'chat_id' });
    return value || '';
  },
  async setChatId(chatId: string): Promise<void> {
    await Preferences.set({ key: 'chat_id', value: chatId });
  }
};
