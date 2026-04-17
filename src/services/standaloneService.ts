import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CapacitorHttp, Capacitor } from '@capacitor/core';

const DATA_DIR = 'news_bot_data';
const isNative = Capacitor.isNativePlatform();

export const storage = {
  async init() {
    if (!isNative) return;
    try {
      await Filesystem.mkdir({
        path: DATA_DIR,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {
      // Directory might already exist
    }
  },

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

  async setSetting(key: string, value: string) {
    if (isNative) {
      await Preferences.set({ key, value });
    } else {
      localStorage.setItem(`setting_${key}`, value);
    }
  },

  async getSetting(key: string) {
    if (isNative) {
      const { value } = await Preferences.get({ key });
      return value;
    } else {
      return localStorage.getItem(`setting_${key}`);
    }
  }
};

// Helper function for logging explicitly to console for Android 
function nativeLog(...args: any[]) {
  console.log('[NativeLog]', ...args);
}

// Telegram API direct calls
export const telegram = {
  async call(token: string, method: string, body: any = {}, signal?: AbortSignal) {
    // Иногда IPv6 маршруты Android конфликтуют с Telegram. Принудительно вызываем fetch/http с IPv4 не получится напрямую в Capacitor,
    // но можно добавить заголовки или изменить fallback.
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    if (isNative) {
      try {
        nativeLog(`SENDING API.TELEGRAM.ORG REQUEST: ${method}`);
        const response = await CapacitorHttp.post({
          url,
          data: body,
          headers: { 
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'Accept': 'application/json'
          },
          connectTimeout: 30000,
          readTimeout: 60000
        });
        nativeLog(`TELEGRAM RESPONSE (${method}): HTTP ${response.status}`, typeof response.data === 'string' ? response.data.substring(0, 100) : 'json object');
        
        let data = response.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { nativeLog('PARSE ERROR', e); }
        }

        if (!data || !data.ok) {
           const errStr = data?.description || `HTTP ${response.status}: Unknown Error`;
           nativeLog(`TELEGRAM API REJECTED:`, errStr);
           throw new Error(errStr);
        }
        return data.result;
      } catch (err: any) {
        nativeLog(`TELEGRAM NETWORK FATAL ERROR (${method}) VIA CAPACITOR HTTP:`, err.message);
        
        // Fallback to exactly native fetch (Web API), because sometimes Capacitor HTTP engine fails on IPv6 while browser fetch works:
        try {
          nativeLog('FALLBACK: Attempting standard Web Fetch API');
          const response = await fetch(url, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(body)
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.description || 'Telegram API Error via Fetch');
          return data.result;
        } catch (fetchErr: any) {
          nativeLog('FETCH FALLBACK ALSO FAILED:', fetchErr.message);
          throw new Error(`Telegram Network Error: ${err.message}`);
        }
      }
    } else {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.description || 'Telegram API Error');
      return data.result;
    }
  },

  async getMe(token: string) {
    return this.call(token, 'getMe');
  },

  async sendMessage(token: string, chatId: string | number, text: string, extra: any = {}) {
    const params: any = {
      chat_id: chatId,
      text,
      ...extra
    };
    // Only add parse_mode if not already specified in extra
    if (!extra.parse_mode) {
      params.parse_mode = 'MarkdownV2';
    }
    return this.call(token, 'sendMessage', params); 
  },

  async sendPhoto(token: string, chatId: string | number, photo: string, caption?: string, extra: any = {}) {
    const params: any = {
      chat_id: chatId,
      photo,
      caption,
      ...extra
    };
    // Only add parse_mode if not already specified in extra
    if (!extra.parse_mode && caption) {
      params.parse_mode = 'MarkdownV2';
    }
    return this.call(token, 'sendPhoto', params);
  },

  async sendMediaGroup(token: string, chatId: string | number, media: any[]) {
    // Media group doesn't support buttons or parse_mode for captions in the same way
    // Each media item can have its own caption with parse_mode
    return this.call(token, 'sendMediaGroup', {
      chat_id: chatId,
      media: media
    });
  },

  async getUpdates(token: string, offset?: number, signal?: AbortSignal) {
    return this.call(token, 'getUpdates', { offset, timeout: 30 }, signal);
  }
};

export const aiService = {
  async processWithAI(text: string, apiKey: string, prompt: string, provider: string = 'gemini') {
    if (!apiKey) throw new Error("AI API Key is missing");
    // Gemini
    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const fullPrompt = `${prompt}\n\nTEXT:\n${text}`;
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      return response.text();
    }

    // GitHub (Azure OpenAI compatible)
    if (provider === 'github') {
      const response = await axios.post(
        "https://models.inference.ai.azure.com/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `${prompt}\n\nTEXT:\n${text}` }],
          temperature: 0.7,
          max_tokens: 4000
        },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: 60000
        }
      );
      return response.data.choices?.[0]?.message?.content || "";
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }
};

export const scraperService = {
  async fetchUrl(url: string) {
    // Use CapacitorHttp to bypass CORS on Android
    const response = await CapacitorHttp.get({ url });
    return response.data;
  },

  async extractContent(html: string) {
    const $ = cheerio.load(html);
    // Basic extraction logic similar to server.ts
    $('script, style, nav, footer, header, ads').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  }
};
