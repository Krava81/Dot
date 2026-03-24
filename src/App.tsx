/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, CheckCircle2, AlertCircle, MessageSquare, Cpu, Send, Link as LinkIcon, Hash, Key, Settings, Edit2, Save, X, Activity, Trash2 } from 'lucide-react';
import { processNewsText } from './services/geminiService';
import { Capacitor, CapacitorHttp, CapacitorCookies } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const getInitialBaseUrl = () => {
  if (window.location.href.includes('run.app')) {
    return window.location.origin;
  }
  const saved = localStorage.getItem('tg_bot_server_url');
  if (saved) return saved;
  return process.env.VITE_APP_URL || '';
};

export default function App() {
  const [baseUrl, setBaseUrl] = useState(getInitialBaseUrl());
  const [status, setStatus] = useState<{ status: string; bot: string; pendingTasks: number; hasDefaultChat: boolean; lastChatId: string | number | null; botWaitRemaining?: number } | null>(null);
  const [serverStatus, setServerStatus] = useState<{ hasServerKey: boolean, serverKeyMasked: string | null } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const addClientLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] [Client] ${msg}`, ...prev].slice(0, 50));
  };
  const [isWorking, setIsWorking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('app_session_token') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showCookieFixer, setShowCookieFixer] = useState(false);
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [fullResponse, setFullResponse] = useState<string | null>(null);
  const [isTestingNet, setIsTestingNet] = useState(false);
  const [netTestResult, setNetTestResult] = useState<string | null>(null);

  // Универсальный загрузчик v5.0
  const universalFetch = async (url: string, options: any = {}) => {
    const platform = Capacitor.getPlatform();
    const isNative = platform === 'android' || platform === 'ios';
    const isNativePlatform = Capacitor.isNativePlatform();
    const isWebMirror = window.location.href.includes('run.app');
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-App-Version': '5.0',
      ...(options.headers || {})
    };

    if (sessionToken) {
      (headers as any)['Authorization'] = `Bearer ${sessionToken}`;
      (headers as any)['X-Session-Token'] = sessionToken;
      // v5.0: Если токен содержит '=', передаем его как Cookie для обхода прокси
      if (isNative && sessionToken.includes('=')) {
        (headers as any)['Cookie'] = sessionToken;
      }
    }
    
    if ((isNative || isNativePlatform) && !isWebMirror) {
      try {
        const http = CapacitorHttp || (Capacitor as any).Plugins?.CapacitorHttp;
        
        // v4.7: Принудительно добавляем метку версии и сессии в URL для обхода кэша прокси
        let finalUrl = url;
        if (!finalUrl.startsWith('http')) {
          finalUrl = `https://${finalUrl}`;
        }
        
        const requestUrl = new URL(finalUrl);
        requestUrl.searchParams.set('v', '5.0');
        if (sessionToken) requestUrl.searchParams.set('sid', sessionToken.substring(0, 8));

        const res = await http.request({
          url: requestUrl.toString(),
          method: options.method || 'GET',
          headers,
          data: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined,
          connectTimeout: 15000,
          readTimeout: 15000
        });
        
        // v4.4: Если сервер вернул HTML вместо JSON — это почти всегда страница логина Google или ошибка прокси
        const isHtml = typeof res.data === 'string' && (res.data.includes('<!doctype html>') || res.data.includes('<html'));
        
        if (isHtml) {
          if (res.data.includes('google-signin') || res.data.includes('Cookie check') || res.data.includes('login')) {
            addClientLog("⚠️ Обнаружена защита Google Cloud Run. Требуется вход.");
            throw new Error("AI_STUDIO_AUTH_REQUIRED");
          }
          // Если это просто какая-то другая ошибка в виде HTML
          if (res.status === 403 || res.status === 401) {
            throw new Error("AI_STUDIO_AUTH_REQUIRED");
          }
        }

        if (res.status === 404) throw new Error("API_NOT_FOUND");

        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          statusText: `Status ${res.status}`,
          json: async () => typeof res.data === 'string' ? JSON.parse(res.data) : res.data,
          text: async () => typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
          headers: {
            get: (name: string) => {
              if (!res.headers) return null;
              const val = res.headers[name] || res.headers[name.toLowerCase()] || res.headers[name.toUpperCase()];
              return val || null;
            }
          }
        };
      } catch (err: any) {
        console.error(`[NativeFetch] Error: ${err.message}`);
        throw err;
      }
    } else {
      try {
        const res = await fetch(url, { ...options, headers });
        
        // v4.1: Detect AI Studio Proxy "Cookie Check" in Web mode
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
          const text = await res.clone().text();
          if (text.includes('Cookie check')) {
            throw new Error("AI_STUDIO_COOKIE_CHECK");
          }
        }
        
        return res;
      } catch (err: any) {
        if (err.message === "AI_STUDIO_COOKIE_CHECK") throw err;
        throw err;
      }
    }
  };
  const [isDeepLogin, setIsDeepLogin] = useState(() => {
    return new URLSearchParams(window.location.search).get('mode') === 'app_return';
  });

  // v3.1: Handle return from Deep Login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'app_return') {
      setIsDeepLogin(false);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchData();
    }
  }, []);

  // v3.0: Safety timeout for loading screen
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        console.log("[v3.0] Loading timeout reached, forcing UI display");
        setLoading(false);
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [loading]);

  const DEV_URL = "https://ais-dev-rmq2x3cl372oyaqjtvr24s-648683748313.europe-west2.run.app";
  const PRE_URL = "https://ais-pre-rmq2x3cl372oyaqjtvr24s-648683748313.europe-west2.run.app";

  const switchToUrl = (url: string) => {
    setBaseUrl(url);
    localStorage.setItem('tg_bot_server_url', url);
    addClientLog(`Переключено на URL: ${url}`);
    fetchData();
  };

  const openInBrowser = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: baseUrl });
      } else {
        window.open(baseUrl, '_blank');
      }
    } catch (e: any) {
      window.open(baseUrl, '_blank');
    }
  };

  const startDeepLogin = async () => {
    try {
      await Browser.open({ url: baseUrl });
      fetchData();
    } catch (e: any) {
      console.error(e);
    }
  };

  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [warmUpStatus, setWarmUpStatus] = useState<string | null>(null);

  const startWebViewSync = async () => {
    if (!baseUrl || baseUrl.length < 5) {
      setWarmUpStatus("❌ Сначала укажите URL сервера в настройках!");
      setIsWarmingUp(true);
      setTimeout(() => setIsWarmingUp(false), 3000);
      return;
    }

    setIsWarmingUp(true);
    setWarmUpStatus("Открытие в Chrome...");
    
    try {
      // v4.7: Используем Browser.open для открытия во внешнем браузере (Chrome)
      // Это решает проблему бесконечной загрузки во внутреннем WebView
      let finalBaseUrl = baseUrl.trim();
      if (!finalBaseUrl.startsWith('http')) {
        finalBaseUrl = `https://${finalBaseUrl}`;
      }
      
      const syncUrl = new URL(`${finalBaseUrl.endsWith('/') ? finalBaseUrl.slice(0, -1) : finalBaseUrl}/api/auth/sync`);
      syncUrl.searchParams.set('app_mode', 'true');
      syncUrl.searchParams.set('v', '5.0');
      syncUrl.searchParams.set('ts', Date.now().toString());
      
      addClientLog(`Открытие внешней ссылки: ${syncUrl.toString()}`);
      
      // Открываем во внешнем браузере через плагин Capacitor Browser
      await Browser.open({ url: syncUrl.toString() });
      
      setWarmUpStatus("Скопируйте токен из браузера");
      setTimeout(() => setIsWarmingUp(false), 5000);
    } catch (e: any) {
      addClientLog(`❌ Ошибка: ${e.message}`);
      setWarmUpStatus("❌ Ошибка. Проверьте настройки.");
      setTimeout(() => setIsWarmingUp(false), 3000);
    }
  };

  const testNetwork = async () => {
    setIsTestingNet(true);
    setNetTestResult("Тестирование...");
    try {
      const res = await fetch("https://api.github.com", { method: 'GET' });
      if (res.ok) {
        setNetTestResult("✅ Интернет есть (GitHub доступен)");
      } else {
        setNetTestResult(`❌ Ошибка сети: ${res.status}`);
      }
    } catch (e: any) {
      setNetTestResult(`❌ Нет доступа к интернету: ${e.message}`);
    } finally {
      setIsTestingNet(false);
    }
  };
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  
  // Manual Input State
  const [manualUrl, setManualUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [tempBotToken, setTempBotToken] = useState('');

  useEffect(() => {
    if (showSettings) {
      setTempBotToken('');
    }
  }, [showSettings]);

  const handleSaveSettings = async () => {
    setIsSubmitting(true);
    setSubmitMsg(null);
    try {
      let url = baseUrl.trim();
      if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
      setBaseUrl(url);
      localStorage.setItem('tg_bot_server_url', url);

      if (tempBotToken) {
        localStorage.setItem('tg_bot_token', tempBotToken);
        setBotToken(tempBotToken);
        const cleanBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const res = await universalFetch(`${cleanBaseUrl}/api/config/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tempBotToken })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || `Ошибка сервера: ${res.status}`);
        }
      }

      setSubmitMsg({ type: 'success', text: 'Настройки сохранены! Бот перезапускается...' });
      setTimeout(() => setShowSettings(false), 2000);
    } catch (err) {
      setSubmitMsg({ type: 'error', text: err instanceof Error ? err.message : 'Ошибка соединения с сервером' });
    } finally {
      setIsSubmitting(false);
      fetchData();
    }
  };

  // v5.0: Принудительная установка Cookie (включая прокси-куки)
  useEffect(() => {
    const syncNativeCookies = async () => {
      if (sessionToken && baseUrl && (Capacitor.isNativePlatform())) {
        try {
          let url = baseUrl.trim();
          if (!url.startsWith('http')) url = `https://${url}`;
          const domain = new URL(url).hostname;
          
          addClientLog(`Синхронизация нативных Cookie для ${domain}...`);
          
          // v5.0: Если токен содержит '=', это полный набор Cookie
          if (sessionToken.includes('=')) {
            const cookiePairs = sessionToken.split('; ');
            for (const pair of cookiePairs) {
              const [key, value] = pair.split('=');
              if (key && value) {
                await CapacitorCookies.setCookie({
                  url: url,
                  key: key.trim(),
                  value: value.trim(),
                  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                  path: '/',
                });
              }
            }
            addClientLog("✅ Нативные Cookie синхронизированы (полный набор).");
          } else {
            // Одиночный токен SESS
            await CapacitorCookies.setCookie({
              url: url,
              key: 'SESS',
              value: sessionToken,
              expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              path: '/',
            });
            addClientLog("✅ Нативные Cookie синхронизированы (SESS).");
          }
        } catch (e: any) {
          addClientLog(`❌ Ошибка синхронизации Cookie: ${e.message}`);
        }
      }
    };
    syncNativeCookies();
  }, [sessionToken, baseUrl]);

  useEffect(() => {
    if (baseUrl) {
      localStorage.setItem('tg_bot_server_url', baseUrl);
    }
  }, [baseUrl]);

  // API Key Management State
  const [apiKeys, setApiKeys] = useState(() => {
    const saved = localStorage.getItem('tg_bot_api_keys');
    return saved ? JSON.parse(saved) : [
      { label: 'Ключ 1', key: '' },
      { label: 'Ключ 2', key: '' },
      { label: 'Ключ 3', key: '' }
    ];
  });
  const [activeKeyIndex, setActiveKeyIndex] = useState(() => {
    const saved = localStorage.getItem('tg_bot_active_key_index');
    if (saved) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  });
  const [editingKeyIndex, setEditingKeyIndex] = useState<number | null>(null);
  const [tempKeyLabel, setTempKeyLabel] = useState('');
  const [tempKeyValue, setTempKeyValue] = useState('');

  useEffect(() => {
    localStorage.setItem('tg_bot_api_keys', JSON.stringify(apiKeys));
  }, [apiKeys]);

  useEffect(() => {
    localStorage.setItem('tg_bot_active_key_index', activeKeyIndex.toString());
  }, [activeKeyIndex]);

  const [isTestingKey, setIsTestingKey] = useState<number | null>(null);
  const [keyTestResult, setKeyTestResult] = useState<{ index: number, success: boolean, message: string } | null>(null);

  const handleSaveSessionToken = (token: string) => {
    const cleanToken = token.trim();
    setSessionToken(cleanToken);
    localStorage.setItem('app_session_token', cleanToken);
    addClientLog("Токен сессии обновлен.");
    fetchData();
  };

  const testApiKey = async (index: number) => {
    const key = apiKeys[index].key;
    if (!key || key.trim().length < 10) {
      setKeyTestResult({ index, success: false, message: 'Ключ слишком короткий или пустой' });
      return;
    }

    setIsTestingKey(index);
    setKeyTestResult(null);
    try {
      // We'll use a simple prompt to test the key
      await processNewsText("Test", "This is a test message to verify the API key.", key);
      setKeyTestResult({ index, success: true, message: 'Ключ работает!' });
    } catch (e: any) {
      let msg = e.message || String(e);
      if (msg.includes("API key not valid") || msg.includes("invalid_api_key")) {
        msg = "Неверный API ключ. Проверьте правильность копирования.";
      } else if (msg.includes("quota") || msg.includes("rate_limit")) {
        msg = "Превышена квота или лимит запросов.";
      } else if (msg.includes("model not found") || msg.includes("model_not_found")) {
        msg = "Модель не найдена или недоступна для этого ключа.";
      }
      setKeyTestResult({ index, success: false, message: msg });
    } finally {
      setIsTestingKey(null);
    }
  };

  const handleSaveKey = () => {
    if (editingKeyIndex !== null) {
      const newKeys = [...apiKeys];
      newKeys[editingKeyIndex] = { label: tempKeyLabel, key: tempKeyValue };
      setApiKeys(newKeys);
      setEditingKeyIndex(null);
      setKeyTestResult(null);
    }
  };

  const openEditModal = (index: number) => {
    setEditingKeyIndex(index);
    setTempKeyLabel(apiKeys[index].label);
    setTempKeyValue(apiKeys[index].key);
  };

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        // If no key is selected via dialog, show the button
        setNeedsKey(!hasKey);
      } else {
        // If not in AI Studio (e.g. mobile), check if we have any manual keys
        const hasManualKey = apiKeys.some(k => k.key && k.key.trim().length > 10);
        setNeedsKey(!hasManualKey);
      }
    };
    checkKey();
  }, [apiKeys]);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setNeedsKey(false);
    } else {
      // On mobile, scroll to keys section
      const keysSection = document.getElementById('api-keys-section');
      if (keysSection) {
        keysSection.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Bot Token State
  const [botToken, setBotToken] = useState(() => localStorage.getItem('tg_bot_token') || '');
  const [isSavingToken, setIsSavingToken] = useState(false);

  const handleSaveTokenToServer = async () => {
    if (!botToken) return;
    setIsSavingToken(true);
    setSubmitMsg(null);
    try {
      const currentBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const res = await universalFetch(`${currentBaseUrl}/api/config/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botToken })
      });
      if (res.ok) {
        setSubmitMsg({ type: 'success', text: 'Токен сохранен на сервере и бот перезапущен!' });
        addClientLog("Токен успешно сохранен на сервере.");
        localStorage.setItem('tg_bot_token_backup', botToken);
      } else {
        const errText = await res.text();
        addClientLog(`Ошибка сохранения токена: ${errText}`);
        throw new Error(errText);
      }
    } catch (err: any) {
      setSubmitMsg({ type: 'error', text: `Ошибка сохранения: ${err.message}` });
      addClientLog(`Ошибка: ${err.message}`);
    } finally {
      setIsSavingToken(false);
      fetchData();
    }
  };

  const handleSaveTokenToLocal = () => {
    if (!botToken) return;
    localStorage.setItem('tg_bot_token', botToken);
    addClientLog("Токен сохранен локально.");
    setSubmitMsg({ type: 'success', text: 'Токен сохранен локально в приложении.' });
  };

  const fetchData = async () => {
    if (!baseUrl || baseUrl === '/') {
      setLoading(false);
      return;
    }

    try {
      let url = baseUrl.trim();
      if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
      const currentBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const statusRes = await universalFetch(`${currentBaseUrl}/api/status?t=${Date.now()}`, { signal: controller.signal });
      
      // Дополнительно запрашиваем статус конфигурации (API ключи на сервере)
      try {
        const configRes = await universalFetch(`${currentBaseUrl}/api/config/status?t=${Date.now()}`, { signal: controller.signal });
        if (configRes.ok) {
          const configData = await configRes.json();
          setServerStatus({ hasServerKey: configData.hasServerKey, serverKeyMasked: configData.serverKeyMasked });
        }
      } catch (e) {
        console.warn("Failed to fetch server config status", e);
      }

      clearTimeout(timeoutId);

      if (!statusRes.ok) {
        const err = `Ошибка сервера: ${statusRes.status}`;
        setLastError(err);
        setStatus(null);
        return;
      }

      const statusContentType = statusRes.headers.get("content-type");

      if (statusContentType && statusContentType.includes("text/html")) {
        const fullText = await statusRes.text();
        setFullResponse(fullText);
        const htmlSnippet = fullText.slice(0, 150).replace(/</g, '&lt;');
        const err = `Сервер вернул HTML вместо данных. Начало текста: "${htmlSnippet}..."`;
        setLastError("Server returned a web page instead of data");
        setStatus(null);
        return;
      }

      const statusData = await statusRes.json();
      setStatus(statusData);
      setLastError(null);

      // Fetch logs
      try {
        const logsRes = await universalFetch(`${currentBaseUrl}/api/logs?t=${Date.now()}`);
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          setLogs(logsData.logs || []);
        }
      } catch (e) {}
    } catch (err: any) {
      if (err.message === "AI_STUDIO_COOKIE_CHECK" || err.message === "AI_STUDIO_AUTH_REQUIRED") {
        setLastError("Требуется авторизация Google (Mirror Mode)");
        setStatus(null);
      } else {
        const errMsg = err.message || String(err);
        setLastError(errMsg);
        setStatus(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setIsTestingConnection(true);
    setSubmitMsg(null);
    try {
      let url = baseUrl.trim();
      if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
      const currentBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await universalFetch(`${currentBaseUrl}/api/ping`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        setSubmitMsg({ type: 'success', text: 'Соединение с сервером установлено!' });
      } else {
        throw new Error(`Ошибка: ${res.status}`);
      }
    } catch (err: any) {
      setSubmitMsg({ type: 'error', text: `Ошибка соединения: ${err.message || 'Сервер недоступен'}` });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUrl) return;
    
    setIsSubmitting(true);
    setSubmitMsg(null);
    
    try {
      const currentBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const res = await universalFetch(`${currentBaseUrl}/api/process-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: manualUrl })
      });
      
      if (res.ok) {
        setSubmitMsg({ type: 'success', text: 'Ссылка принята! ИИ начинает обработку.' });
        setManualUrl('');
      } else {
        const errText = await res.text();
        setSubmitMsg({ type: 'error', text: `Ошибка: ${errText}` });
      }
    } catch (err) {
      setSubmitMsg({ type: 'error', text: 'Сетевая ошибка при отправке ссылки.' });
    } finally {
      setIsSubmitting(false);
      fetchData();
    }
  };

  useEffect(() => {
    const syncToken = async () => {
      if (status && status.bot === 'offline' && botToken) {
        console.log("Syncing bot token to server...");
        try {
          const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
          await universalFetch(`${cleanBaseUrl}/api/config/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: botToken })
          });
        } catch (e) {
          console.error("Failed to sync bot token", e);
        }
      }
    };
    if (status) syncToken();
  }, [status, botToken, baseUrl]);

  // AI Worker Logic
  useEffect(() => {
    const workerInterval = setInterval(async () => {
      if (isWorking || !baseUrl) return;

      try {
        const currentBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const res = await universalFetch(`${currentBaseUrl}/api/tasks`);
        if (!res.ok) {
          if (res.status === 404) return;
          throw new Error(`Server responded with ${res.status}`);
        }
        
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
          console.log("Worker: Server is still starting up (received HTML)...");
          setIsWorking(false);
          return;
        }
        
        if (!contentType || !contentType.includes("application/json")) {
          console.error("Worker: Expected JSON but got something else");
          setIsWorking(false);
          return;
        }

        const task = await res.json();

        if (task) {
          setIsWorking(true);
          console.log("Processing task:", task.id);
          
          try {
            if (!task.data.text || task.data.text.trim().length < 10) {
              throw new Error("Текст статьи слишком короткий или пустой.");
            }

            // Fallback: if active key is empty, try to find any non-empty key
            let keyToUse = apiKeys[activeKeyIndex]?.key;
            if (!keyToUse || keyToUse.trim().length < 10) {
              const fallbackKey = apiKeys.find((k: any) => k.key && k.key.trim().length > 10);
              if (fallbackKey) {
                console.log("Active key is empty, using fallback key:", fallbackKey.label);
                keyToUse = fallbackKey.key;
              }
            }

            const adaptedText = await processNewsText(
              task.data.title, 
              task.data.text, 
              keyToUse
            );
            
            const completeRes = await universalFetch(`${currentBaseUrl}/api/tasks/${task.id}/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adaptedText })
            });

            if (!completeRes.ok) {
              throw new Error(`Ошибка при завершении задачи: ${completeRes.statusText}`);
            }
          } catch (e) {
            console.error("Task processing failed", e);
            // Report error back to server so it can be logged and task can be removed
            await universalFetch(`${currentBaseUrl}/api/tasks/${task.id}/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adaptedText: `⚠️ Ошибка при обработке новости: ${e instanceof Error ? e.message : String(e)}` })
            });
          } finally {
            setIsWorking(false);
            fetchData();
          }
        }
      } catch (err) {
        if (err instanceof TypeError && err.message === 'Failed to fetch') {
          // Silent fail for network issues during polling
        } else {
          console.error("Worker error:", err);
        }
        setIsWorking(false);
      }
    }, 1000); // Faster polling (1s)

    return () => clearInterval(workerInterval);
  }, [isWorking, baseUrl, activeKeyIndex, apiKeys]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [baseUrl, sessionToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 space-y-6">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full"
        />
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-white">Загрузка панели управления...</h2>
          <p className="text-sm text-neutral-500">Проверка связи с сервером v5.0</p>
        </div>
        <button 
          onClick={() => setLoading(false)}
          className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs rounded-xl transition-all"
        >
          Пропустить загрузку
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <MessageSquare className="text-blue-500 w-8 h-8" />
              Telegram Новостной Бот <span className="text-xs opacity-50">v4.3 (Build: 24.03.2026 06:10)</span>
            </h1>
            <p className="text-neutral-400">Панель управления автоматическим сбором и обработкой новостей</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 bg-neutral-900 border border-neutral-800 rounded-full text-neutral-400 hover:text-white transition-all hover:bg-neutral-800"
              title="Настройки"
            >
              <Settings size={20} />
            </button>
            <div className="flex bg-neutral-900 border border-neutral-800 rounded-full p-1">
              <button 
                onClick={() => switchToUrl(DEV_URL)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                  baseUrl === DEV_URL ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                DEV
              </button>
              <button 
                onClick={() => switchToUrl(PRE_URL)}
                className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all ${
                  baseUrl === PRE_URL ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                PRE
              </button>
            </div>
            {needsKey && (
              <button
                onClick={handleOpenKeyDialog}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-full flex items-center gap-2 text-sm transition-all animate-pulse"
              >
                <AlertCircle size={16} />
                Выбрать API Ключ
              </button>
            )}
            <div className={`px-4 py-2 rounded-full border flex items-center gap-2 text-sm font-medium ${
              status ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {status ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              Сервер: {status ? 'Онлайн' : 'Оффлайн'}
              {!status && lastError && (
                <span className="text-[10px] opacity-70 ml-1 truncate max-w-[150px]">
                  ({lastError})
                </span>
              )}
              {!status && (
                <button 
                  onClick={() => {
                    const debugInfo = `URL: ${baseUrl}\nToken: ${sessionToken ? 'Set (starts with ' + sessionToken.substring(0, 5) + ')' : 'Not Set'}\nPlatform: ${Capacitor.getPlatform()}\nError: ${lastError}`;
                    alert(debugInfo);
                    addClientLog("Debug Info: " + debugInfo);
                  }}
                  className="ml-2 p-1 hover:bg-white/10 rounded"
                  title="Отладка сети"
                >
                  <Activity size={12} />
                </button>
              )}
            </div>
            
            {!status && lastError === "Server returned a web page instead of data" && (
              <button
                onClick={() => window.open(baseUrl, '_blank')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full flex items-center gap-2 text-sm transition-all shadow-lg shadow-blue-500/20"
              >
                🛠 Исправить авторизацию (Cookie Fix)
              </button>
            )}
            <div className={`px-4 py-2 rounded-full border flex items-center gap-2 text-sm font-medium ${
              status?.bot === 'active' 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : status?.bot === 'starting' || status?.bot === 'waiting'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {status?.bot === 'active' ? (
                <CheckCircle2 size={16} />
              ) : status?.bot === 'starting' || status?.bot === 'waiting' ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <AlertCircle size={16} />
              )}
              Бот: {
                status?.bot === 'active' ? 'Активен' : 
                status?.bot === 'waiting' ? `Ожидание (${status?.botWaitRemaining}с)` :
                status?.bot === 'starting' ? 'Запуск...' : 'Оффлайн'
              }
            </div>
            <div className={`px-4 py-2 rounded-full border flex items-center gap-2 text-sm font-medium ${
              isWorking ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'
            }`}>
              <Cpu size={16} className={isWorking ? 'animate-pulse' : ''} />
              ИИ-Воркер: {isWorking ? 'Обработка' : 'Ожидание'}
            </div>
          </div>
        </header>

        {/* Web Mirror Mode Alert - v4.3 Token Support */}
        {!window.location.href.includes('run.app') && Capacitor.isNativePlatform() && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 flex flex-col gap-4">
            <div className="text-center">
              <p className="text-amber-400 font-bold">Мобильный режим (Native App)</p>
              <p className="text-xs text-amber-500/70">Если сервер защищен Google Auth, используйте синхронизацию или вставьте токен</p>
            </div>
            
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap justify-center gap-3">
                <button 
                  onClick={startWebViewSync}
                  disabled={isWarmingUp}
                  className="flex-1 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isWarmingUp ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                  {isWarmingUp ? warmUpStatus : "Синхронизировать"}
                </button>
                <button 
                  onClick={openInBrowser}
                  className="flex-1 px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-neutral-700"
                >
                  <LinkIcon size={18} />
                  Браузер
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Вставить токен сессии вручную</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={sessionToken}
                    onChange={(e) => handleSaveSessionToken(e.target.value)}
                    placeholder="Вставьте токен из браузера..."
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500/50 transition-all"
                  />
                  {sessionToken && (
                    <button 
                      onClick={() => handleSaveSessionToken('')}
                      className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-neutral-500 italic">
                  * Токен необходим для обхода защиты Google Cloud Run на телефоне.
                </p>
              </div>
            </div>
          </div>
        )}

        {window.location.href.includes('run.app') && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 flex flex-col items-center gap-4">
            <div className="text-center">
              <p className="text-blue-400 font-bold">Вы в веб-версии (Mirror Mode)</p>
              <p className="text-xs text-blue-500/70">Сначала авторизуйтесь, затем скопируйте токен для телефона</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/auth/login');
                    const data = await res.json();
                    if (data.status === 'ok') {
                      alert("Авторизация успешна! Теперь вы можете скопировать токен.");
                    }
                  } catch (e) {
                    alert("Ошибка авторизации.");
                  }
                }}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
              >
                <CheckCircle2 size={18} />
                1. Авторизовать браузер
              </button>
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/auth/token');
                    const data = await res.json();
                    const token = data.token;
                    if (token === 'No session cookie found') {
                      alert("Сначала нажмите 'Авторизовать браузер'!");
                      return;
                    }
                    await navigator.clipboard.writeText(token);
                    alert(`Токен скопирован: ${token.substring(0, 10)}... Вставьте его в приложении на телефоне.`);
                  } catch (e) {
                    alert("Ошибка при получении токена.");
                  }
                }}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all flex items-center gap-2"
              >
                <Key size={18} />
                2. Скопировать токен
              </button>
            </div>
            <p className="text-[10px] text-neutral-500 italic mt-2">
              * Для работы на телефоне (в APK) используйте <b>Shared App URL</b> в настройках (иконка шестеренки).
            </p>
          </div>
        )}

        {/* Bot Management Section */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <MessageSquare className="text-emerald-500" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Настройка Telegram Бота</h2>
              <p className="text-neutral-500 text-sm">Введите токен от @BotFather для запуска бота</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                <Key size={12} /> Токен бота
              </label>
              <input 
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCDEF..."
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-mono"
              />
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSaveTokenToServer}
                disabled={isSavingToken || !botToken}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
              >
                {isSavingToken ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                Сохранить на сервере
              </button>
              <button
                onClick={handleSaveTokenToLocal}
                disabled={!botToken}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all border border-neutral-700"
              >
                <Save size={18} />
                Сохранить локально
              </button>
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl space-y-2">
            <p className="text-neutral-500 text-sm font-medium uppercase tracking-wider">Статус</p>
            <p className="text-2xl font-semibold">{status?.status === 'running' ? 'В норме' : 'Неизвестно'}</p>
          </div>
          <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl space-y-2">
            <p className="text-neutral-500 text-sm font-medium uppercase tracking-wider">Задачи в очереди</p>
            <p className="text-2xl font-semibold text-blue-400">{status?.pendingTasks || 0}</p>
          </div>
          <div className="bg-neutral-900/50 border border-neutral-800 p-6 rounded-2xl space-y-2">
            <p className="text-neutral-500 text-sm font-medium uppercase tracking-wider">Время работы</p>
            <p className="text-2xl font-semibold">Активен</p>
          </div>
        </div>

        {/* API Key Management */}
        <section id="api-keys-section" className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Key className="text-amber-500" size={20} />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Управление API Ключами</h2>
                <p className="text-neutral-500 text-sm">Выберите активный ключ или отредактируйте сохраненные</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="px-3 py-1 bg-neutral-800 border border-neutral-700 rounded-lg flex items-center gap-2 text-neutral-400 text-[10px]">
                <span>Поддерживаются: Gemini, OpenRouter, Grok</span>
              </div>
              {serverStatus?.hasServerKey && (
                <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-2 text-blue-400 text-[10px] font-bold">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  Сервер имеет ключ: {serverStatus.serverKeyMasked}
                </div>
              )}
              {(!apiKeys[activeKeyIndex]?.key) && (
                <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2 text-amber-500 text-xs">
                  <AlertCircle size={14} />
                  <span>В активном слоте нет ключа. Обработка новостей будет невозможна.</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {apiKeys.map((item: any, index: number) => (
              <div 
                key={index}
                className={`relative p-4 rounded-xl border transition-all ${
                  activeKeyIndex === index 
                    ? 'bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/20' 
                    : 'bg-neutral-800/50 border-neutral-700 hover:border-neutral-600'
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold uppercase tracking-widest ${
                      activeKeyIndex === index ? 'text-amber-500' : 'text-neutral-500'
                    }`}>
                      Слот {index + 1}
                    </span>
                    <button 
                      onClick={() => openEditModal(index)}
                      className="p-1.5 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
                      title="Редактировать"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
                  
                  <button 
                    onClick={() => setActiveKeyIndex(index)}
                    className="text-left group"
                  >
                    <h3 className="font-semibold truncate pr-2">{item.label}</h3>
                    <p className="text-[10px] text-neutral-500 font-mono mt-1 truncate">
                      {item.key ? `${item.key.substring(0, 8)}...${item.key.substring(item.key.length - 4)}` : 'Ключ не задан'}
                    </p>
                  </button>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-800/50">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        testApiKey(index);
                      }}
                      disabled={isTestingKey === index || !item.key}
                      className={`text-[10px] font-bold flex items-center gap-1 transition-colors ${
                        keyTestResult?.index === index 
                          ? (keyTestResult.success ? 'text-emerald-500' : 'text-red-500')
                          : 'text-neutral-500 hover:text-amber-500'
                      }`}
                    >
                      {isTestingKey === index ? (
                        <RefreshCw size={10} className="animate-spin" />
                      ) : keyTestResult?.index === index ? (
                        keyTestResult.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />
                      ) : (
                        <Activity size={10} />
                      )}
                      {isTestingKey === index ? 'Проверка...' : keyTestResult?.index === index ? keyTestResult.message : 'Проверить ключ'}
                    </button>
                  </div>

                  {activeKeyIndex === index && (
                    <div className="absolute -top-2 -right-2 bg-amber-500 text-black p-1 rounded-full shadow-lg">
                      <CheckCircle2 size={12} strokeWidth={3} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Manual Input Form */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <LinkIcon className="text-blue-500" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Прямая отправка ссылки</h2>
              <p className="text-neutral-500 text-sm">Вставьте ссылку для мгновенной обработки и отправки в Telegram</p>
            </div>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                <LinkIcon size={12} /> Ссылка на новость
              </label>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="url"
                  placeholder="https://example.com/news-article"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  required
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !manualUrl}
                  className="md:w-48 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  {isSubmitting ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                  {isSubmitting ? 'Отправка...' : 'Отправить'}
                </button>
              </div>
              <p className="text-[10px] text-neutral-500">
                Новости автоматически адаптируются ИИ и отправляются в основной канал.
              </p>
            </div>

            <AnimatePresence>
              {submitMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`p-4 rounded-xl text-sm flex items-center gap-3 ${
                    submitMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {submitMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  {submitMsg.text}
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </section>

        {/* Logs Terminal */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-neutral-800 rounded-lg">
                <Activity className="text-neutral-400" size={20} />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Логи сервера</h2>
                <p className="text-neutral-500 text-sm">Живой поток событий бота</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  const key = apiKeys[activeKeyIndex]?.key;
                  if (key) {
                    alert(`Активный ключ начинается на: ${key.substring(0, 8)}...\nДлина: ${key.length} симв.`);
                  } else {
                    alert("Активный ключ не задан!");
                  }
                }}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-[10px] font-bold rounded-lg transition-all border border-neutral-700"
              >
                Отладка ключа
              </button>
              <button 
                onClick={() => setLogs([])}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Очистить экран
              </button>
            </div>
          </div>

          <div className="bg-black/50 rounded-xl p-4 h-64 overflow-y-auto font-mono text-[10px] space-y-1 border border-neutral-800 scrollbar-thin scrollbar-thumb-neutral-800">
            {logs.length === 0 ? (
              <p className="text-neutral-700 italic">Ожидание логов...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-neutral-600 shrink-0">[{i+1}]</span>
                  <span className={log.includes('Ошибка') || log.includes('Error') ? 'text-red-400' : log.includes('Warning') ? 'text-amber-400' : 'text-neutral-400'}>
                    {log}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Edit Key Modal */}
      </div>

      {/* Edit Key Modal */}
      <AnimatePresence>
        {editingKeyIndex !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingKeyIndex(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Key className="text-amber-500" size={20} />
                  </div>
                  <h3 className="text-xl font-bold">Настройка ключа</h3>
                </div>
                <button 
                  onClick={() => setEditingKeyIndex(null)}
                  className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Название кнопки</label>
                  <input 
                    type="text"
                    value={tempKeyLabel}
                    onChange={(e) => setTempKeyLabel(e.target.value)}
                    placeholder="Например: Основной ключ"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">API Ключ (Gemini)</label>
                  <input 
                    type="password"
                    value={tempKeyValue}
                    onChange={(e) => setTempKeyValue(e.target.value)}
                    placeholder="Вставьте ваш API ключ здесь"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setEditingKeyIndex(null)}
                  className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl transition-all"
                >
                  Отмена
                </button>
                <button 
                  onClick={handleSaveKey}
                  className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                >
                  <Save size={18} />
                  Сохранить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        {/* Cookie Fixer Modal */}
        <AnimatePresence>
          {showCookieFixer && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-3xl h-[90vh] flex flex-col shadow-2xl overflow-hidden"
              >
                <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-800/50">
                  <div>
                    <h3 className="text-lg font-bold">🛠 Cookie Fixer</h3>
                    <p className="text-[10px] text-neutral-400">Войдите в Google здесь, чтобы эмулятор получил доступ к серверу</p>
                  </div>
                  <button onClick={() => setShowCookieFixer(false)} className="p-2 hover:bg-neutral-700 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 bg-white">
                  <iframe 
                    src={baseUrl} 
                    className="w-full h-full border-none"
                    title="Google Auth Fixer"
                  />
                </div>
                <div className="p-4 border-t border-neutral-800 flex justify-between items-center">
                  <span className="text-xs text-amber-400 font-medium">После входа закройте это окно и обновите статус</span>
                  <button onClick={() => setShowCookieFixer(false)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors font-bold">
                    Я вошел, закрыть
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Full Response Modal */}
        <AnimatePresence>
          {showFullResponse && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
              >
                <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                  <h3 className="text-xl font-bold">Полный ответ сервера</h3>
                  <button onClick={() => setShowFullResponse(false)} className="p-2 hover:bg-neutral-800 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 overflow-auto flex-1 font-mono text-xs text-neutral-400 bg-black/20">
                  {fullResponse || "Нет данных. Попробуйте обновить статус сервера."}
                </div>
                <div className="p-6 border-t border-neutral-800 flex justify-end">
                  <button onClick={() => setShowFullResponse(false)} className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors">
                    Закрыть
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Server Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Settings className="text-blue-500" size={20} />
                  </div>
                  <h3 className="text-xl font-bold">Настройки сервера</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">URL Сервера (App URL)</label>
                  <input 
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://your-app.run.app"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                  <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl space-y-2">
                    <p className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                      <AlertCircle size={10} /> ВАЖНО ДЛЯ ЭМУЛЯТОРА:
                    </p>
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                      Для работы в Android Studio используйте <strong>Shared App URL</strong> (из AI Studio). 
                      Обычный URL может быть защищен и недоступен для эмулятора.
                    </p>
                    <p className="text-[10px] text-neutral-400 font-mono break-all">
                      Текущий: {baseUrl || 'не задан'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                    <Key size={12} /> Токен сессии (Session Token)
                  </label>
                  <input 
                    type="text"
                    value={sessionToken}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setSessionToken(val);
                      localStorage.setItem('app_session_token', val);
                    }}
                    placeholder="Вставьте токен из браузера..."
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                  <p className="text-[10px] text-neutral-500">
                    Используйте кнопку "Синхронизировать", чтобы получить этот токен в Chrome.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare size={12} /> Telegram Bot Token
                  </label>
                  <input 
                    type="password"
                    value={tempBotToken}
                    onChange={(e) => setTempBotToken(e.target.value)}
                    placeholder="123456789:ABCDEF..."
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                  <p className="text-[10px] text-neutral-500">
                    Вставьте новый токен от @BotFather, чтобы сбросить старые соединения и перезапустить бота.
                  </p>
                </div>
              </div>

              <AnimatePresence>
                {submitMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`p-4 rounded-xl text-sm flex items-center gap-3 ${
                      submitMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {submitMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    {submitMsg.text}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col gap-3 pt-2">
                <button 
                  onClick={testConnection}
                  disabled={isTestingConnection || !baseUrl}
                  className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 border border-neutral-700"
                >
                  {isTestingConnection ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                  Проверить соединение
                </button>
                <button 
                  onClick={() => {
                    const defaultUrl = process.env.VITE_APP_URL || '';
                    setBaseUrl(defaultUrl);
                  }}
                  className="w-full px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs font-medium rounded-xl transition-all border border-neutral-700"
                >
                  Сбросить на URL по умолчанию
                </button>
                <div className="flex gap-2">
                  <button 
                    onClick={handleSaveSettings}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                    {isSubmitting ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Вы уверены, что хотите полностью сбросить приложение? Все настройки и ключи будут удалены.")) {
                        localStorage.clear();
                        window.location.reload();
                      }
                    }}
                    className="px-4 py-3 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-xl transition-all border border-red-500/20 flex items-center gap-2"
                    title="Сбросить всё"
                  >
                    <Trash2 size={18} />
                    <span className="hidden sm:inline">Сброс</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
