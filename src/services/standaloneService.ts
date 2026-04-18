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

// ─── Universal Fetch ──────────────────────────────────────────────────────
export const universalFetch = async (url: string, options: any = {}) => {
  if (!url || url.includes('undefined') || url.includes('null') || url === 'https://' || url === 'http://') {
    throw new Error("INVALID_URL");
  }
  try { const p = new URL(url); if (!p.hostname) throw new Error(); } catch { throw new Error("MALFORMED_URL"); }

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) };

  // Primary: Standard web fetch (happy eyeballs, native v4/v6 fallback, proxies)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
      headers: { get: (name: string) => res.headers.get(name) }
    } as any;
  } catch (fetchErr: any) {
    if (fetchErr.name === 'AbortError') throw new Error("TIMEOUT_ERROR");
    
    // Secondary Fallback: Capacitor HTTP (if running natively and CORS or Webview blocked the fetch)
    if (isNative) {
      let requestData: any = undefined;
      if (options.method && options.method.toUpperCase() !== 'GET' && options.body) {
        try { requestData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; } 
        catch { requestData = options.body; }
      }
      
      try {
        const response = await CapacitorHttp.request({
          url, method: options.method || 'GET', headers, data: requestData,
          connectTimeout: 30000, readTimeout: 60000,
        });
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: async () => typeof response.data === 'string' ? JSON.parse(response.data) : response.data,
          text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          headers: { get: (name: string) => response.headers?.[name] || response.headers?.[name.toLowerCase()] || null }
        } as any;
      } catch (capErr: any) {
        throw new Error(`Native fallback failed: ${capErr.message || "Unknown"}`);
      }
    }
    
    throw fetchErr;
  }
};

// Telegram API direct calls
export const telegram = {
  async call(token: string, method: string, body: any = {}, signal?: AbortSignal) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    // Telegram API supports CORS out-of-the-box (Access-Control-Allow-Origin: *).
    // Native WebView 'fetch' (Chromium) handles IPv6 -> IPv4 smooth fallback (Happy Eyeballs) beautifully.
    // CapacitorHttp Java layer is known to hard-crash or timeout on IPv6 networks.
    // Therefore, we try the standard fetch FIRST, even on Native.
    try {
      nativeLog(`[Fetch] SENDING TO TELEGRAM: ${method}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      
      const data = await response.json();
      if (!data.ok) throw new Error(data.description || 'Telegram API Error via Web Fetch');
      return data.result;
      
    } catch (fetchErr: any) {
      nativeLog(`[Fetch] FAILED: ${fetchErr.message}. FALLING BACK TO NATIVE CAPACITOR_HTTP...`);
      // If Web Fetch failed (e.g. some webview CORS block or missing network plugin), fallback to native HTTP.
      if (isNative) {
        try {
          const response = await CapacitorHttp.post({
            url,
            data: body,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            connectTimeout: 30000,
            readTimeout: 60000
          });
          
          let data = response.data;
          if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) {}
          }

          if (!data || !data.ok) {
             const errStr = data?.description || `HTTP ${response.status}: Unknown Error`;
             throw new Error(errStr);
          }
          return data.result;
        } catch (nativeErr: any) {
          nativeLog(`[NativeHttp] ALSO FAILED: ${nativeErr.message}`);
          throw new Error(`Telegram Network Error: ${fetchErr.message} (Native fallback: ${nativeErr.message})`);
        }
      } else {
        throw new Error(`Telegram Network Error: ${fetchErr.message}`);
      }
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
    return this.call(token, 'sendMessage', params); 
  },

  async sendPhoto(token: string, chatId: string | number, photo: string, caption?: string, extra: any = {}) {
    const params: any = {
      chat_id: chatId,
      photo,
      caption,
      ...extra
    };
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
  async processWithAI(text: string, keys: any, prompt: string, preferredProvider: string = 'gemini', logCallback: (msg: string) => void = () => {}) {
    const providers = ["gemini", "github", "deepseek", "openrouter"];
    const effective = preferredProvider || "gemini";
    const ordered   = [effective, ...providers.filter(p => p !== effective)];
    const disabledProviders = new Set<string>();

    const lastErrors: string[] = [];

    for (let cycle = 1; cycle <= 3; cycle++) {
      if (cycle > 1) logCallback(`🔄 AI retry ${cycle}/3...`);

      for (const cur of ordered) {
        if (disabledProviders.has(cur)) continue;
        const apiKey = keys[cur];
        if (!apiKey) { lastErrors.push(`${cur}: no key`); continue; }
        
        try {
          let aiResult = "";
          
          if (cur === 'gemini') {
            logCallback(`📡 Gemini (attempt ${cycle})...`);
            const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
            let geminiErr = '';
            for (const modelName of modelsToTry) {
              try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                const r = await universalFetch(url, {
                  method: 'POST',
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: `${prompt}\n\nTEXT:\n${text}` }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
                  })
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
                aiResult = d.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiResult) break;
              } catch (e: any) {
                geminiErr = e.message;
              }
            }
            if (!aiResult) throw new Error(geminiErr);
          }
          
          else if (cur === 'github') {
             logCallback(`📡 GitHub Models (gpt-4o-mini)...`);
             const r = await universalFetch("https://models.inference.ai.azure.com/chat/completions", {
               method: 'POST',
               headers: { "Authorization": `Bearer ${apiKey}` },
               body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `${prompt}\n\nTEXT:\n${text}` }], temperature: 0.1, max_tokens: 4000 })
             });
             const d = await r.json();
             if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
             aiResult = d.choices?.[0]?.message?.content;
          }

          else if (cur === 'openrouter') {
             logCallback(`📡 OpenRouter (gpt-4o-mini)...`);
             const r = await universalFetch("https://openrouter.ai/api/v1/chat/completions", {
               method: 'POST',
               headers: { "Authorization": `Bearer ${apiKey}` },
               body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: `${prompt}\n\nTEXT:\n${text}` }] })
             });
             const d = await r.json();
             if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
             aiResult = d.choices?.[0]?.message?.content;
          }

          else if (cur === 'deepseek') {
             logCallback(`📡 DeepSeek (deepseek-chat)...`);
             const r = await universalFetch("https://api.deepseek.com/chat/completions", {
               method: 'POST',
               headers: { "Authorization": `Bearer ${apiKey}` },
               body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: `${prompt}\n\nTEXT:\n${text}` }], temperature: 0.1 })
             });
             const d = await r.json();
             if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
             aiResult = d.choices?.[0]?.message?.content;
          }

          if (aiResult) {
            logCallback(`✅ AI processing succeeded using provider: ${cur}`);
            return aiResult;
          }

        } catch (err: any) {
           const msg = err.message || String(err);
           logCallback(`❌ AI Provider ${cur} error: ${msg}`);
           lastErrors.push(`${cur}: ${msg}`);
        }
      }
    }

    throw new Error(`Все AI провайдеры не сработали.\nЛоги:\n${lastErrors.join('\n')}`);
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
