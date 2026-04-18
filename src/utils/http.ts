import { Capacitor } from '@capacitor/core';

/**
 * Безопасная работа с LocalStorage.
 */
export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch {}
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch {}
  },
  clear: (): void => {
    try { localStorage.clear(); } catch {}
  }
};

/**
 * Проверка, запущено ли приложение в нативном окружении.
 */
export const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

/**
 * Получение начального URL сервера.
 */
export const getInitialBaseUrl = (): string => {
  try {
    if (typeof window !== 'undefined' && window.location.href.includes('run.app')) {
      return window.location.origin;
    }
    return safeLocalStorage.getItem('tg_bot_server_url') || '';
  } catch { return ''; }
};

/**
 * Очистка вводимого URL.
 */
export const sanitizeBaseUrlInput = (raw: string): string => {
  return String(raw || '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
};

/**
 * Нормализация пресетов Chat ID.
 */
export const normalizeChatIdPresets = (value: unknown): string[] => {
  const presets = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as any).presets))
      ? (value as any).presets
      : [];
  const normalized = presets.slice(0, 3).map((item: any) => String(item ?? '').trim());
  while (normalized.length < 3) normalized.push('');
  return normalized;
};

/**
 * Проверка необходимости использования HTTP вместо HTTPS.
 */
export const shouldPreferHttp = (rawHost: string): boolean => {
  const host = rawHost.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  if (/^(10|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./.test(host)) return true;
  return false;
};
