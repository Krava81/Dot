import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import fs from 'fs';
import path from 'path';

const isNative = Capacitor.isNativePlatform();
const DATA_DIR = 'app_data';

export const storageWrapper = {
  async readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    if (isNative) {
      try {
        const filename = path.basename(filePath);
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(result.data as string);
      } catch (e) {
        return defaultValue;
      }
    } else {
      try {
        if (fs.existsSync(filePath)) {
          return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
      } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
      }
      return defaultValue;
    }
  },

  async writeJsonFile(filePath: string, data: any): Promise<void> {
    if (isNative) {
      try {
        await Filesystem.mkdir({ path: DATA_DIR, directory: Directory.Data, recursive: true });
      } catch (e) {}
      const filename = path.basename(filePath);
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: JSON.stringify(data, null, 2),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
    } else {
      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
      } catch (err) {
        console.error(`Error writing ${filePath}:`, err);
      }
    }
  },

  async readTextFile(filePath: string, defaultValue = ''): Promise<string> {
    if (isNative) {
      try {
        const filename = path.basename(filePath);
        const result = await Filesystem.readFile({
          path: `${DATA_DIR}/${filename}`,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return (result.data as string).trim();
      } catch (e) {
        return defaultValue;
      }
    } else {
      try {
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, "utf-8").trim();
        }
      } catch {}
      return defaultValue;
    }
  },

  async writeTextFile(filePath: string, content: string): Promise<void> {
    if (isNative) {
      try {
        await Filesystem.mkdir({ path: DATA_DIR, directory: Directory.Data, recursive: true });
      } catch (e) {}
      const filename = path.basename(filePath);
      await Filesystem.writeFile({
        path: `${DATA_DIR}/${filename}`,
        data: content,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
    } else {
      try {
        fs.writeFileSync(filePath, content, "utf-8");
      } catch (err) {
        console.error(`Error writing ${filePath}:`, err);
      }
    }
  }
};
