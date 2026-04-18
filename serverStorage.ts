import fs from 'fs';
import path from 'path';

export const serverStorage = {
  async readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch (e) {
      console.error(`Error reading ${filePath}:`, e);
    }
    return defaultValue;
  },

  async writeJsonFile(filePath: string, data: any): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`Error writing ${filePath}:`, err);
    }
  },

  async readTextFile(filePath: string, defaultValue = ''): Promise<string> {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8").trim();
      }
    } catch (e) {
      console.error(`Error reading ${filePath}:`, e);
    }
    return defaultValue;
  },

  async writeTextFile(filePath: string, content: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, "utf-8");
    } catch (err) {
      console.error(`Error writing ${filePath}:`, err);
    }
  }
};
