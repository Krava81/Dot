import { Capacitor, CapacitorHttp } from '@capacitor/core';
 
let useNativeHttpSetting = true;

export const setUseNativeHttp = (val: boolean) => {
  useNativeHttpSetting = val;
  console.log(`[HTTP] useNativeHttp set to: ${val}`);
};

const isNative = () => {
  try {
    return useNativeHttpSetting && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
 
// ✅ Конфигурация retry для мобильных сетей
const RETRY_CONFIG = {
  maxRetries: 5, 
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 1.5
};
 
// ✅ Улучшенная функция retry с экспоненциальным backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = RETRY_CONFIG.maxRetries,
  delay = RETRY_CONFIG.initialDelay
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries === 0) throw error;
    
    // ✅ Проверяем, стоит ли повторять запрос
    const shouldRetry = 
      error.message?.includes('timeout') ||
      error.message?.includes('ETIMEDOUT') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND') ||
      error.message?.includes('network') ||
      error.name === 'AbortError' ||
      error.name === 'NetworkError' ||
      (error.status >= 500 && error.status < 600);
    
    if (!shouldRetry) throw error;
    
    console.log(`[HTTP] Retrying in ${delay}ms... (${RETRY_CONFIG.maxRetries - retries + 1}/${RETRY_CONFIG.maxRetries})`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const nextDelay = Math.min(
      delay * RETRY_CONFIG.backoffMultiplier,
      RETRY_CONFIG.maxDelay
    );
    
    return retryWithBackoff(fn, retries - 1, nextDelay);
  }
}
 
export async function universalFetch(url: string, options: any = {}) {
  // ✅ Валидация URL
  if (!url || url.includes('undefined') || url.includes('null') || url === 'https://' || url === 'http://') {
    throw new Error("INVALID_URL");
  }
  
  try {
    const p = new URL(url);
    if (!p.hostname) throw new Error();
  } catch {
    throw new Error("MALFORMED_URL");
  }
 
  const headers = { 
    'Content-Type': 'application/json', 
    'Accept': 'application/json', 
    ...(options.headers || {}) 
  };
 
  // ✅ Увеличен таймаут для мобильных сетей
  const timeout = options.timeout || 120000; 
 
  // ✅ Используем retry wrapper
  if (options.skipRetry) {
    return executeFetch();
  }

  return retryWithBackoff(executeFetch);

  async function executeFetch() {
    // ✅ На Android используем Capacitor HTTP напрямую для лучшей совместимости
    if (isNative()) {
      let requestData: any = options.body;
      
      // ✅ Исправление сериализации для CapacitorHttp
      if (requestData instanceof FormData || requestData instanceof Blob) {
        // Оставляем как есть
      } else if (typeof requestData === 'string') {
        try { requestData = JSON.parse(requestData); } catch { /* оставляем строку */ }
      } else {
        // Оставляем объект как есть для CapacitorHttp
      }
      
      try {
        console.log(`[HTTP Native] ${options.method || 'GET'} ${url}`);
        const response = await CapacitorHttp.request({
          url, 
          method: options.method || 'GET', 
          headers, 
          data: requestData,
          connectTimeout: 60000, 
          readTimeout: timeout, 
        });
        
        console.log(`[HTTP Native] Response ${response.status} from ${url}`);
        
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: async () => {
            if (!response.data) return {};
            if (typeof response.data === 'string') {
               try { return JSON.parse(response.data); } catch { return {}; }
            }
            return response.data;
          },
          text: async () => {
            if (!response.data) return "";
            const text = typeof response.data === 'string' 
              ? response.data 
              : JSON.stringify(response.data);
            return text;
          },
          headers: { 
            get: (name: string) => 
              response.headers?.[name] || 
              response.headers?.[name.toLowerCase()] || 
              null 
          }
        } as any;
      } catch (capErr: any) {
        console.error(`[HTTP Native] Error:`, capErr);
        throw new Error(`Native HTTP error: ${capErr.message || "Unknown"}`);
      }
    }
 
    // ✅ Web fetch с улучшенной обработкой
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      // ✅ Конвертируем body для fetch
      let body = options.body;
      if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        body = JSON.stringify(body);
      }
      
      console.log(`[HTTP Web] ${options.method || 'GET'} ${url}`);
      
      const fetchOptions: RequestInit = {
        ...options,
        headers,
        body,
        signal: controller.signal,
        mode: 'cors',
        cache: 'no-cache'
      };
      
      const res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      console.log(`[HTTP Web] Response ${res.status} from ${url}`);
      
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
        text: () => res.text(),
        headers: { get: (name: string) => res.headers.get(name) }
      } as any;
    } catch (fetchErr: any) {
      console.error(`[HTTP Web] Error:`, fetchErr);
      
      if (fetchErr.name === 'AbortError') {
        throw new Error("TIMEOUT_ERROR");
      }
      
      throw fetchErr;
    }
  }
}
 
// ✅ Специальная функция для Telegram API с дополнительными retry
export async function telegramFetch(url: string, options: any = {}) {
  return retryWithBackoff(
    () => universalFetch(url, options),
    7, 
    1500 
  );
}
