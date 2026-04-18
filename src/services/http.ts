import { Capacitor, CapacitorHttp } from '@capacitor/core';

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export async function universalFetch(url: string, options: any = {}) {
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

  // Primary: Standard web fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    // Convert body if it's an object (for web fetch compatibility with some APIs)
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      body = JSON.stringify(body);
    }
    
    const res = await fetch(url, { 
      credentials: 'include',
      ...options, 
      headers, 
      body, 
      signal: controller.signal 
    });
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
    
    // Secondary Fallback: Capacitor HTTP
    if (isNative()) {
      let requestData: any = undefined;
      if (options.method && options.method.toUpperCase() !== 'GET' && options.body) {
        try { 
          requestData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; 
        } 
        catch { 
          requestData = options.body; 
        }
      }
      
      try {
        const response = await CapacitorHttp.request({
          url, 
          method: options.method || 'GET', 
          headers, 
          data: requestData,
          connectTimeout: 30000, 
          readTimeout: 60000,
        });
        
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: async () => typeof response.data === 'string' ? JSON.parse(response.data) : response.data,
          text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          headers: { get: (name: string) => response.headers?.[name] || response.headers?.[name.toLowerCase()] || null }
        } as any;
      } catch (capErr: any) {
        throw new Error(`Fetch failed: ${fetchErr.message}. Native fallback failed: ${capErr.message || "Unknown"}`);
      }
    }
    
    throw fetchErr;
  }
}
