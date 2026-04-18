import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const isNative = Capacitor.isNativePlatform();
const DATA_DIR = 'news_bot_data';

export const storageWrapper = {
  async readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    if (isNative) {
      try {
        const filename = filePath.split('/').pop() || filePath;
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(result.data as string);
      } catch (e) {
        return defaultValue;
      }
    } else {
      const filename = filePath.split('/').pop() || filePath;
      const data = localStorage.getItem(`wrap_${filename}`);
      return data ? JSON.parse(data) : defaultValue;
    }
  },

  async writeJsonFile(filePath: string, data: any): Promise<void> {
    if (isNative) {
      try {
        await Filesystem.mkdir({ path: DATA_DIR, directory: Directory.Documents, recursive: true });
      } catch (e) {}
      const filename = filePath.split('/').pop() || filePath;
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: JSON.stringify(data, null, 2),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
    } else {
      const filename = filePath.split('/').pop() || filePath;
      localStorage.setItem(`wrap_${filename}`, JSON.stringify(data));
    }
  },

  async readTextFile(filePath: string, defaultValue = ''): Promise<string> {
    if (isNative) {
      try {
        const filename = filePath.split('/').pop() || filePath;
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        return (result.data as string).trim();
      } catch (e) {
        return defaultValue;
      }
    } else {
      const filename = filePath.split('/').pop() || filePath;
      return localStorage.getItem(`wrap_${filename}`) || defaultValue;
    }
  },

  async writeTextFile(filePath: string, content: string): Promise<void> {
    if (isNative) {
      try {
        await Filesystem.mkdir({ path: DATA_DIR, directory: Directory.Documents, recursive: true });
      } catch (e) {}
      const filename = filePath.split('/').pop() || filePath;
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: content,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
    } else {
      const filename = filePath.split('/').pop() || filePath;
      localStorage.setItem(`wrap_${filename}`, content);
    }
  }
};
