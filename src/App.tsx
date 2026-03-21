/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, MessageSquare, Cpu, Send, Link as LinkIcon, Hash, Key, Settings, Edit2, Save, X } from 'lucide-react';
import { processNewsText } from './services/geminiService';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const getInitialBaseUrl = () => {
  const saved = localStorage.getItem('tg_bot_server_url');
  if (saved) return saved;
  return process.env.VITE_APP_URL || '';
};

// Универсальный загрузчик v2.1 (Максимальная совместимость с эмулятором)
const universalFetch = async (url: string, options: any = {}) => {
  const platform = Capacitor.getPlatform();
  const isNative = platform === 'android' || platform === 'ios';
  const isNativePlatform = Capacitor.isNativePlatform();
  const isLocalhost = window.location.hostname === 'localhost';
  
  if (isNative || isNativePlatform || isLocalhost) {
    console.log(`[Diagnostic v2.1] universalFetch called for: ${url}`);
    try {
      // Ensure data is properly handled for POST/PUT
      let requestData = undefined;
      if (options.body) {
        try {
          requestData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        } catch (e) {
          console.warn("[Diagnostic v2.1] Failed to parse body as JSON, sending as is:", e);
          requestData = options.body;
        }
      }

      // Use either the direct import or the plugin registry
      const http = CapacitorHttp || (Capacitor as any).Plugins?.CapacitorHttp;
      
      if (!http) {
        console.error("[Diagnostic v2.1] CapacitorHttp plugin not found!");
        throw new Error("CapacitorHttp plugin not found");
      }

      const res = await http.request({
        url: url.includes('?') ? `${url}&v=2.1` : `${url}?v=2.1`,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          ...(options.headers || {})
        },
        data: requestData,
        connectTimeout: 15000,
        readTimeout: 15000
      });
      
      console.log(`[Diagnostic v2.1] CapacitorHttp response status: ${res.status} for ${url}`);
      
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
    } catch (err) {
      console.error("[Diagnostic v2.1] CapacitorHttp error:", err);
      // Fallback to fetch ONLY if we are NOT on a native platform
      if (!isNative && !isNativePlatform) {
        console.warn("[Diagnostic v2.1] Falling back to standard fetch on web");
        return fetch(url, options);
      }
      throw err;
    }
  } else {
    console.log(`[Diagnostic v2.1] Using standard fetch for: ${url}`);
    return fetch(url, options);
  }
};

export default function App() {
  const [baseUrl, setBaseUrl] = useState(getInitialBaseUrl);
  const [logs, setLogs] = useState<string[]>([]);
  const [clientLogs, setClientLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<{ status: string; bot: string; pendingTasks: number; hasDefaultChat: boolean; lastChatId: string | number | null } | null>(null);
  
  const addClientLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setClientLogs(prev => [`[Diag ${time}] ${msg}`, ...prev].slice(0, 20));
    console.log(`[Diagnostic v2.2] ${msg}`);
  };
  const [loading, setLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
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
    return saved ? parseInt(saved, 10) : 0;
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

  const handleSaveKey = () => {
    if (editingKeyIndex !== null) {
      const newKeys = [...apiKeys];
      newKeys[editingKeyIndex] = { label: tempKeyLabel, key: tempKeyValue };
      setApiKeys(newKeys);
      setEditingKeyIndex(null);
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
        // Even if GEMINI_API_KEY exists, it might be the free one that doesn't work for Gemini 3
        setNeedsKey(!hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setNeedsKey(false);
    }
  };

  const fetchData = async () => {
    if (!baseUrl || baseUrl === '/') return;

    try {
      let url = baseUrl.trim();
      if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
      const currentBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      addClientLog(`Запрос статуса: ${currentBaseUrl}/api/status`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const [logsRes, statusRes] = await Promise.all([
        universalFetch(`${currentBaseUrl}/api/logs?t=${Date.now()}`, { signal: controller.signal }),
        universalFetch(`${currentBaseUrl}/api/status?t=${Date.now()}`, { signal: controller.signal })
      ]);
      
      clearTimeout(timeoutId);

      if (!logsRes.ok || !statusRes.ok) {
        const err = `Ошибка сервера: ${logsRes.status} / ${statusRes.status}`;
        addClientLog(err);
        setLastError(err);
        setStatus(null);
        return;
      }

      const logsContentType = logsRes.headers.get("content-type");
      const statusContentType = statusRes.headers.get("content-type");

      if ((logsContentType && logsContentType.includes("text/html")) || 
          (statusContentType && statusContentType.includes("text/html"))) {
        const htmlSnippet = await statusRes.text().then(t => t.slice(0, 150).replace(/</g, '&lt;'));
        const err = `Сервер вернул HTML вместо данных. Начало текста: "${htmlSnippet}..."`;
        addClientLog(err);
        setLastError("Ошибка: Сервер вернул веб-страницу вместо данных");
        setStatus(null);
        return;
      }

      const logsData = await logsRes.json();
      const statusData = await statusRes.json();
      setLogs(logsData.logs || []);
      setStatus(statusData);
      setLastError(null);
      addClientLog("Данные успешно обновлены");
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addClientLog(`Ошибка: ${errMsg}`);
      setLastError(errMsg);
      setStatus(null);
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

            const adaptedText = await processNewsText(
              task.data.title, 
              task.data.text, 
              apiKeys[activeKeyIndex]?.key
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
  }, [baseUrl]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <MessageSquare className="text-blue-500 w-8 h-8" />
              Telegram Новостной Бот <span className="text-xs opacity-50">v2.4</span>
            </h1>
            <p className="text-neutral-400">Панель управления автоматическим сбором и обработкой новостей</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-neutral-400 transition-colors"
              title="Настройки сервера"
            >
              <Settings size={20} />
            </button>
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
                <span className="text-[10px] opacity-70 ml-1 truncate max-w-[100px]">({lastError})</span>
              )}
            </div>
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
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
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
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden flex flex-col h-[500px]">
          <div className="bg-neutral-800/50 px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
              <Terminal size={16} className="text-blue-400" />
              Живые логи бота
            </div>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/20" />
              <div className="w-3 h-3 rounded-full bg-amber-500/20" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/20" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-sm">
            <AnimatePresence initial={false}>
              {clientLogs.map((log, i) => (
                <motion.div
                  key={`client-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-blue-400 border-l-2 border-blue-500/50 bg-blue-500/5 pl-3 py-0.5 transition-all"
                >
                  <span className="text-blue-600 mr-2">[CLIENT]</span>
                  {log}
                </motion.div>
              ))}
              {logs.length === 0 && clientLogs.length === 0 ? (
                <p className="text-neutral-600 italic">Логов пока нет. Ожидание сообщений...</p>
              ) : (
                logs.map((log, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-neutral-400 border-l-2 border-transparent hover:border-blue-500/50 hover:bg-neutral-800/30 pl-3 py-0.5 transition-all"
                  >
                    <span className="text-neutral-600 mr-2">[{i + 1}]</span>
                    {log}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="bg-blue-500/5 border border-blue-500/10 p-6 rounded-2xl space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ExternalLink size={20} className="text-blue-400" />
            Инструкции по настройке
          </h3>
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-400 text-sm flex items-start gap-3">
            <AlertCircle className="shrink-0" size={18} />
            <p>
              <strong>Важно:</strong> Обработка Gemini AI теперь запускается в вашем браузере для соблюдения правил безопасности. 
              Держите эту вкладку открытой, чтобы бот мог обрабатывать новости автоматически.
            </p>
          </div>
          <ul className="space-y-2 text-neutral-400 text-sm list-disc list-inside">
            <li>Создайте бота через <a href="https://t.me/BotFather" className="text-blue-400 hover:underline">@BotFather</a> и получите токен.</li>
            <li>Добавьте бота в ваш исходный канал и целевой канал (как администратора).</li>
            <li>Получите ID каналов (используйте <a href="https://t.me/userinfobot" className="text-blue-400 hover:underline">@userinfobot</a> или аналоги).</li>
            <li>Настройте переменные окружения в меню Secrets.</li>
            <li>Держите эту вкладку открытой для фоновой обработки.</li>
          </ul>
        </div>
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
                      localStorage.clear();
                      window.location.reload();
                    }}
                    className="px-4 py-3 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-xl transition-all border border-red-500/20"
                    title="Сбросить всё"
                  >
                    <RefreshCw size={18} />
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
