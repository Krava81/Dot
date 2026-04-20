/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Component, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, CheckCircle2, AlertCircle, MessageSquare, Cpu, Send, Hash, Key, Settings, Edit2, Save, X, Activity, Trash2, Sparkles, ChevronDown, Image, Calendar, Clock, Plus, Eye, EyeOff, Copy, FolderOpen, Check, Loader2, Folder, GripVertical, Smartphone, Play, Globe, Layout, Palette, Type, Wand2, ClipboardPaste } from 'lucide-react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { storage } from './services/storage';
import { telegram, TelegramAPI } from './services/telegram';
import { AIService } from './services/aiService';
import { AIProcessingError } from './utils/errors';
import { universalFetch, setUseNativeHttp } from './services/http';
import { errorTracker } from './utils/errorTracker';
import { sanitizeForTelegram } from './utils/telegramHtml';
import { mdToTelegramHtml, mdToTelegramMarkdown } from './utils/markdown';
import { APP_VERSION, LOG_LIMIT, RETRY_CONFIG } from './constants';
import { useDrafts } from './hooks/useDrafts';
import { useDebounce } from './hooks/useDebounce';
import { useAndroidLifecycle } from './hooks/useAndroidLifecycle';
import { useServerConnection } from './hooks/useServerConnection';
import { useImageSync } from './hooks/useImageSync';
import { useButtonTemplates } from './hooks/useButtonTemplates';
import { useScheduledPosts } from './hooks/useScheduledPosts';
import { usePublishedPosts } from './hooks/usePublishedPosts';
import { useAiKeys } from './hooks/useAiKeys';
import { useBotSettings } from './hooks/useBotSettings';
import { useLinkPresets } from './hooks/useLinkPresets';
import { SettingsModal } from './components/SettingsModal';
import { PostConstructor } from './components/PostConstructor';
import { PostButton, ParsedContent, DraftPost, ButtonTemplate, ServerConfigStatus } from './types';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  safeLocalStorage, 
  isNative, 
  getInitialBaseUrl, 
  sanitizeBaseUrlInput, 
  normalizeChatIdPresets, 
  shouldPreferHttp 
} from './utils/http';

// ─── Components ─────────────────────────────────────────────────────────────
const SortableImage = ({ id, url, onSelect, onEnlarge, isMain, onSetMain }: any) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1, opacity: isDragging ? 0.5 : 1 };

  const handleClick = useCallback(() => {
    try {
      onEnlarge?.(url);
    } catch (e) {
      console.error('[SortableImage] Error enlarging image:', e);
    }
  }, [onEnlarge, url]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(url);
    } catch (e) {
      console.error('[SortableImage] Error deleting image:', e);
    }
  }, [onSelect, url]);

  return (
    <div ref={setNodeRef} style={style} className="relative group aspect-square rounded-lg overflow-hidden border border-neutral-800 transition-all">
      <div className="w-full h-full cursor-pointer" onClick={handleClick}>
        <img
          src={url}
          alt="Post"
          className="w-full h-full object-cover pointer-events-none"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={(e) => {
            console.error('[SortableImage] Image load error:', url);
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      {isMain && (
        <div className="absolute bottom-1 left-1 px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded shadow">
          Основное
        </div>
      )}
      <button 
        className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-500/80 rounded-full text-white cursor-pointer shadow-md pointer-events-auto" 
        onClick={handleDelete}
        title="Удалить"
      >
        <X size={14} />
      </button>
      <div className="absolute top-1 left-1 p-1 touch-none pointer-events-auto z-[30]" {...attributes} {...listeners}>
        <div className="p-1 bg-black/60 rounded shadow cursor-grab active:cursor-grabbing">
          <GripVertical size={12} className="text-white" />
        </div>
      </div>
    </div>
  );
};

const CollapsibleSection = ({ title, children, isOpen, onToggle, icon: Icon }: any) => (
  <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden mb-4">
    <button onClick={onToggle} className="w-full px-6 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
      <div className="flex items-center gap-3">
        {Icon && <Icon className="w-5 h-5 text-neutral-500" />}
        <h2 className="text-lg font-semibold text-neutral-800">{title}</h2>
      </div>
      <motion.div animate={{ rotate: isOpen ? 180 : 0 }}><ChevronDown className="w-5 h-5 text-neutral-400" /></motion.div>
    </button>
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: 'easeInOut' }}>
          <div className="px-6 pb-6 border-t border-neutral-100">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

declare global {
  interface Window {
    aistudio: { hasSelectedApiKey: () => Promise<boolean>; openSelectKey: () => Promise<void>; };
  }
}

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("App Crash:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-8 text-center">
          <AlertCircle size={48} className="text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Произошла ошибка</h1>
          <p className="text-neutral-400 mb-6 max-w-md">{this.state.error ? String((this.state.error as any).message || this.state.error) : "Неизвестная ошибка"}</p>
          <div className="flex flex-col gap-4">
            <button onClick={() => { Preferences.remove({ key: 'tg_bot_server_url' }); window.location.reload(); }} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-2xl font-bold transition-all">Сбросить URL и перезагрузить</button>
            <button onClick={() => { Preferences.clear(); window.location.reload(); }} className="px-8 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-2xl font-bold transition-all">Полный сброс</button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}

// ─── Main App ────────────────────────────────────────────────────────────────
function AppContent() {
  const [isStandalone, setIsStandalone] = useState(true);

  // ─── Startup Default Mode ──────────────────────────────────────────────────
  useEffect(() => {
    const initSettings = async () => {
      try {
        const standalone = await Preferences.get({ key: 'setting_is_standalone' });
        // default to standalone (true) if never set
        const val = standalone.value !== null ? standalone.value === 'true' : true;
        setIsStandalone(val);
        console.log(`[App] Initialized Standalone mode: ${val}`);
      } catch (e) {
        console.error("[App] Failed to load standalone setting", e);
        setIsStandalone(true);
      }
    };
    initSettings();
  }, []);

  const [baseUrl, setBaseUrl] = useState(() => getInitialBaseUrl());
  const [serverStatus, setServerStatus] = useState<ServerConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLogsPaused, setIsLogsPaused] = useState(false);
  const [isLogsCollapsed, setIsLogsCollapsed] = useState(true);
  const [isLogsFullscreen, setIsLogsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'images' | 'logs'>('editor');
  const [showSettings, setShowSettings] = useState(false);

  // ─── Validate URL ─────────────────────────────────────────────────────────
  const getCleanBaseUrl = useCallback((url?: string) => {
    let u = sanitizeBaseUrlInput(url !== undefined ? url : baseUrl);
    if (!u) return null;
    try {
      const full = u.startsWith('http')
        ? u
        : `${shouldPreferHttp(u) ? 'http' : 'https'}://${u}`;
      const parsed = new URL(full);
      if (!parsed.hostname) return null;
      return full.endsWith('/') ? full.slice(0, -1) : full;
    } catch { return null; }
  }, [baseUrl]);

  const { 
    botToken, 
    tempChatId, 
    updateSetting: updateBotSetting,
    loadSettings: loadBotSettings 
  } = useBotSettings(isStandalone);

  const telegramClient = useMemo(() => 
    botToken ? new TelegramAPI(botToken) : null,
    [botToken]
  );

  const aiServiceInstance = useMemo(() => 
    new AIService(RETRY_CONFIG), 
    []
  );

  const updateSetting = async (key: string, value: string) => {
    if (key === 'standalone_bot_token' || key === 'server_bot_token') {
      await updateBotSetting(key, value);
    } else if (key === 'setting_is_standalone') {
      setIsStandalone(value === 'true');
      await Preferences.set({ key: 'setting_is_standalone', value });
    } else if (key === 'chat_id') {
      await updateBotSetting('chat_id', value);
    } else if (key === 'use_native_http') {
      const isNativeOn = value === 'true';
      setUseNativeHttpState(isNativeOn);
      setUseNativeHttp(isNativeOn);
      await storage.setSetting('use_native_http', value);
    }
  };

  const [tempBotToken, setTempBotToken] = useState('');
  const [tempBaseUrl, setTempBaseUrl] = useState(() => getInitialBaseUrl());
  const [chatIdPresets, setChatIdPresets] = useState<string[]>(['', '', '']);
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isActionInProgress, setIsActionInProgress] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [lastSaved, setLastSaved] = useState({ text: '', images: [] });

  const lastSavedRef = useRef({ text: '', images: [] as string[] });
  const [isTestingNet, setIsTestingNet] = useState(false);
  const [netTestResult, setNetTestResult] = useState<string | null>(null);
  const [isBotOnline, setIsBotOnline] = useState(false);
  const [botRestartCounter, setBotRestartCounter] = useState(0);
  const [useNativeHttp, setUseNativeHttpState] = useState(true);
  const [isDiagnosticsRunning, setIsDiagnosticsRunning] = useState(false);
  const [botOffset, setBotOffset] = useState(0);
  const [filterRecentImages, setFilterRecentImages] = useState(true);
  const [syncedImages, setSyncedImages] = useState<string[]>([]);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // ─── Auto-clear submit messages ───────────────────────────────────────────
  useEffect(() => {
    if (submitMsg) {
      const timer = setTimeout(() => {
        setSubmitMsg(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [submitMsg]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Constructor state
  const [isConstructorOpen, setIsConstructorOpen] = useState(false);
  const [parsedContent, setParsedContent] = useState<ParsedContent | null>(null);
  const [aiProcessedText, setAiProcessedText] = useState('');
  const [htmlProcessed, setHtmlProcessed] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  
  const debouncedText = useDebounce(aiProcessedText, 2000);
  const debouncedImages = useDebounce(selectedImages, 1000);

  const [mainImage, setMainImage] = useState<string>('');
  const [postButtons, setPostButtons] = useState<PostButton[]>([]);
  const [originalText, setOriginalText] = useState('');
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [newButtonText, setNewButtonText] = useState('');
  const [newButtonUrl, setNewButtonUrl] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(true);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  // Lists state
  const { drafts, setDrafts, loading: draftsLoading, saveDraft: saveDraftHook, deleteDraft: deleteDraftHook, reload: reloadDrafts } = useDrafts(isStandalone, getCleanBaseUrl, universalFetch);
  const loadDrafts = reloadDrafts;
  const { buttonTemplates, setButtonTemplates, loadButtonTemplates, saveButtonTemplate, deleteButtonTemplate } = useButtonTemplates(isStandalone, getCleanBaseUrl, universalFetch);
  const { linkPresets, saveLinkPresets, loadLinkPresets } = useLinkPresets(isStandalone, getCleanBaseUrl, universalFetch);
  const { scheduledPosts, setScheduledPosts, loadScheduledPosts } = useScheduledPosts(isStandalone, getCleanBaseUrl, universalFetch);
  const { publishedPosts, setPublishedPosts, loadPublishedPosts, savePublishedPost, deletePublishedPost } = usePublishedPosts(isStandalone, getCleanBaseUrl, universalFetch);

  // ✅ INITIALIZATION
  useEffect(() => {
    if (isStandalone) {
      storage.init().then(() => {
        console.log('[App] Storage initialized');
        loadAllStandaloneData();
      });
    }
  }, [isStandalone]);

  const loadAllStandaloneData = async () => {
    loadDrafts();
    loadButtonTemplates();
    loadScheduledPosts();
    loadPublishedPosts();
    loadLinkPresets();
    
    // Load local settings
    const sToken = isStandalone
      ? await storage.getSecure('bot_token')
      : await storage.getSetting('server_bot_token');
    if (sToken) updateSetting(isStandalone ? 'standalone_bot_token' : 'server_bot_token', sToken);

    const chatId = await storage.getSetting('chat_id');
    if (chatId) updateSetting('chat_id', chatId);

    const githubKey = await storage.getSetting('api_key_github');
    if (githubKey) updateAiKey('github', githubKey);
    const openrouterKey = await storage.getSetting('api_key_openrouter');
    if (openrouterKey) updateAiKey('openrouter', openrouterKey);
    const deepseekKey = await storage.getSetting('api_key_deepseek');
    if (deepseekKey) updateAiKey('deepseek', deepseekKey);

    const prefProvider = await storage.getSetting('preferred_provider');
    if (prefProvider) {
      setServerStatus(prev => ({ ...prev, preferredProvider: prefProvider } as any));
    }

    const nativeHttp = await storage.getSetting('use_native_http');
    if (nativeHttp !== null) {
      const isNativeOn = nativeHttp === 'true';
      setUseNativeHttpState(isNativeOn);
      setUseNativeHttp(isNativeOn);
    }
  };

  // ✅ ANDROID LIFECYCLE
  useAndroidLifecycle(
    // onPause - приложение ушло в background
    () => {
      console.log('[Android] App paused - saving state');
      if (aiProcessedText || selectedImages.length > 0) {
        saveDraft('draft');
      }
    },
    // onResume - приложение вернулось из background
    () => {
      console.log('[Android] App resumed - refreshing data');
      loadDrafts();
      if (!isStandalone) refetchStatus();
      syncLocalImages();
    }
  );

  const [isDraftsCollapsed, setIsDraftsCollapsed] = useState(true);
  const [isScheduledCollapsed, setIsScheduledCollapsed] = useState(true);
  const [isPublishedOpen, setIsPublishedOpen] = useState(false);
  const [isBotCollapsed, setIsBotCollapsed] = useState(true);
  const [isAiKeysCollapsed, setIsAiKeysCollapsed] = useState(true);
  const { aiKeys, updateAiKey } = useAiKeys(isStandalone);

  const { 
    imagePath, setImagePath, isActionInProgress: isImageActionInProgress, 
    browserPath, setBrowserPath, browserDirs, setBrowserDirs, browserParent, setBrowserParent,
    saveImagePath: saveImagePathHook
  } = useImageSync(isStandalone, getCleanBaseUrl);

  const handleSaveImagePath = async () => {
    await saveImagePathHook(imagePath);
    setSubmitMsg({ type: 'success', text: 'Путь к изображениям сохранен' });
  };

  const cleanBaseUrl = useMemo(() => {
    return getCleanBaseUrl();
  }, [getCleanBaseUrl]);

  const syncLocalImages = useCallback(async (shouldSavePath = false, overridePath?: string) => {
    setIsActionInProgress(true);
    setLastError(null);
    
    try {
      if (isStandalone) {
        // Request permissions first
        if (isNative()) {
          const perm = await Filesystem.checkPermissions();
          if (perm.publicStorage !== 'granted') {
            const req = await Filesystem.requestPermissions();
            if (req.publicStorage !== 'granted') {
              throw new Error("Нет разрешения на доступ к хранилищу. Пожалуйста, разрешите доступ в настройках приложения.");
            }
          }
        }

        let pathToScan = overridePath || imagePath || 'Pictures';
        
        // Clean up path
        if (pathToScan.startsWith('/storage/emulated/0/')) {
          pathToScan = pathToScan.replace('/storage/emulated/0/', '');
        } else if (pathToScan.startsWith('/')) {
          pathToScan = pathToScan.substring(1);
        }

        try {
          const result = await Filesystem.readdir({
            path: pathToScan,
            directory: Directory.ExternalStorage,
          });
          
          const imgs = result.files
            .filter(f => f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i))
            .map(f => ({
              uri: Capacitor.convertFileSrc(f.uri),
              name: f.name
            }));
            
          if (imgs.length === 0) {
            setLastError(`В папке "${pathToScan}" не найдено изображений. Проверьте путь.`);
          } else {
            const imgUris = imgs.map(i => i.uri).slice(-50); // limit gallery to 50
            setSyncedImages(imgUris);
            setSubmitMsg({ type: 'success', text: `Найдено ${imgs.length} изображений` });
          }

          if (shouldSavePath && pathToScan) {
            await Preferences.set({ key: 'standalone_image_path', value: pathToScan });
            setImagePath(pathToScan);
          }
        } catch (e: any) {
          console.error('Filesystem readdir error:', e);
          setLastError(`Ошибка доступа к "${pathToScan}": ${e.message}. Убедитесь, что путь указан относительно корня хранилища (например, DCIM/Camera).`);
        }
        
        return;
      }
      
      // 2️⃣ Server: синхронизируем с сервером
      const cleanUrl = getCleanBaseUrl();
      if (!cleanUrl) return;
      
      const pathToUse = overridePath || imagePath;
      if (shouldSavePath && pathToUse) {
        await universalFetch(`${cleanUrl}/api/config/image-path`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: { path: pathToUse } 
        }).catch(() => {});
      }
  
      const r = await universalFetch(`${cleanUrl}/api/images/sync?filterRecent=${filterRecentImages}`);
      if (r.ok) {
        const data = await r.json();
        const rawImgs = Array.isArray(data.images) ? data.images : [];
        const imgs = rawImgs
          .map((url: unknown) => String(url ?? ''))
          .filter(Boolean)
          .map((url: string) => url.startsWith('http') ? url : `${cleanUrl}${url}`);
        
        setSyncedImages(imgs);
        setSelectedImages(prev => {
          const combined = [...new Set([...prev, ...imgs])];
          return combined.slice(-50);
        });
        
        if (!mainImage && imgs.length > 0) setMainImage(imgs[0]);
        
        setParsedContent(prev => {
          const ex = prev?.images || [];
          const combined = [...new Set([...ex, ...imgs])];
          return prev ? { ...prev, images: combined } : { 
            title: '', 
            text: '', 
            images: combined 
          };
        });
      }
    } catch (err: any) {
      console.error('Failed to sync images:', err);
      if (!isStandalone) {
        setSubmitMsg({ type: 'error', text: `Ошибка синхронизации: ${err.message}` });
      }
    } finally {
      setIsActionInProgress(false);
    }
  }, [isStandalone, getCleanBaseUrl, filterRecentImages, universalFetch, imagePath, mainImage]);

  const saveImagePath = useCallback(async () => {
    await syncLocalImages(true);
  }, [syncLocalImages]);



  // ─── Logs ─────────────────────────────────────────────────────────────────
  const addClientLog = useCallback((msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] [Client] ${msg}`;
    setLogs(prev => [line, ...prev].slice(0, LOG_LIMIT));
  }, []);

  // ─── Fetch Data ───────────────────────────────────────────────────────────
    // ─── Standalone Initialization ───────────────────────────────────────────
  useEffect(() => {
    if (isStandalone) {
      storage.init().then(() => {
        addClientLog("📦 Локальное хранилище инициализировано");
        loadAllStandaloneData();
        loadButtonTemplates(); // Load templates on init
      });
    }
  }, [isStandalone, loadButtonTemplates]);

  // ─── Standalone Bot Polling ───────────────────────────────────────────────
  useEffect(() => {
    if (!isStandalone || !botToken) {
      if (isStandalone && !botToken) {
        addClientLog("⚠️ Бот не запущен: отсутствует токен в настройках.");
      }
      return;
    }

    addClientLog(`🚀 Запуск Telegram Bot (Standalone)...`);
    let isPolling = true;
    const abortController = new AbortController();

    const poll = async () => {
      let offset = botOffset;
      addClientLog("🔌 Подключение к Telegram API...");
      
      while (isPolling) {
        try {
          const updates = await telegramClient?.getUpdates(offset, abortController.signal);
          
          if (!isBotOnline) {
             setIsBotOnline(true);
             addClientLog("✅ Бот онлайн! Ожидание сообщений...");
          }

          if (!isPolling) break;
          for (const update of updates) {
            offset = update.update_id + 1;
            setBotOffset(offset);
            if (update.message && update.message.text) {
              addClientLog(`📩 Сообщение: ${update.message.text}`);
              handleStandaloneBotMessage(update.message);
            }
          }
        } catch (e: any) {
          setIsBotOnline(false);
          if (e.name === 'AbortError') break;
          
          const httpMode = isNative() ? "Системный (Native)" : "Браузерный (Fetch)";
          if (e.message?.includes('409') || e.message?.includes('Conflict')) {
            addClientLog(`🔴 ОШИБКА 409: Конфликт! (${httpMode}). Проверьте, не запущен ли бот где-то еще.`);
          } else {
            const isNetworkErr = e.message?.toLowerCase().includes('failed') || e.message?.includes('status 0') || e.name === 'NetworkError';
            const errExt = isNetworkErr 
                ? `\n🌐 Режим: ${httpMode}\nℹ️ СОВЕТ: Проверьте VPN или смените "Сетевой режим" в настройках.` 
                : ` (Режим: ${httpMode})`;
            addClientLog(`⚠️ Ошибка Telegram: ${e.message}${errExt}`);
          }
          // Exponential backoff on error
          await new Promise(r => setTimeout(r, 5000));
        }
        if (isPolling) await new Promise(r => setTimeout(r, 2000));
      }
    };

    poll();
    return () => { 
      isPolling = false; 
      abortController.abort();
      addClientLog("🛑 Бот остановлен.");
    };
  }, [isStandalone, botToken, botRestartCounter]);

  const handleStandaloneBotMessage = async (message: any) => {
    const text = message.text;
    if (text === '/start') {
      await telegramClient?.sendMessage(message.chat.id, "✅ Бот запущен автономно!\n\nПришлите текст для публикации.", { parse_mode: 'HTML' });
      return;
    }
    addClientLog(`📝 Обработка текста: ${text.substring(0, 20)}...`);
    // Future: Add AI processing here
  };

  const { status, loading: serverLoading, error: serverError, refetch: refetchStatus } = useServerConnection(isStandalone ? '' : baseUrl);
  
  useEffect(() => {
    const updateStatus = async () => {
      if (status) {
        // Fetch config status separately - don't block
        const cleanUrl = getCleanBaseUrl();
        if (cleanUrl) {
          try {
            const r = await universalFetch(`${cleanUrl}/api/config/status`);
            const d = await r.json();
            setServerStatus(d);
          } catch {}
        }
      }
      if (serverError) setLastError(serverError);
      else if (!serverLoading) setLastError(null);
    };
    updateStatus();
  }, [status, serverError, serverLoading, getCleanBaseUrl, universalFetch]);

  // ─── Effects ──────────────────────────────────────────────────────────────

  // Loading timeout
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // Main data polling
  useEffect(() => {
    // fetchData is now handled by useServerConnection
  }, []);

  // ✅ FIX: SSE only for web, polling for native
  useEffect(() => {
    if (isNative()) return;  // EventSource not supported in Android WebView
    if (!baseUrl || isLogsPaused || isLogsCollapsed) return;

    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connectSSE = () => {
      try {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`${cleanUrl}/api/logs/stream`);
        eventSource.onmessage = (event) => {
          try { const log = JSON.parse(event.data); setLogs(prev => [log, ...prev].slice(0, 50)); } catch {}
        };
        eventSource.onerror = () => {
          if (eventSource) eventSource.close();
          eventSource = null;
          reconnectTimeout = setTimeout(connectSSE, 5000);
        };
      } catch { reconnectTimeout = setTimeout(connectSSE, 10000); }
    };

    connectSSE();
    return () => { if (eventSource) eventSource.close(); if (reconnectTimeout) clearTimeout(reconnectTimeout); };
  }, [baseUrl, isLogsPaused, isLogsCollapsed, getCleanBaseUrl]);

  // ─── DnD ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSelectedImages(items => { const oi = items.indexOf(active.id as string); const ni = items.indexOf(over.id as string); return arrayMove(items, oi, ni); });
    }
  };

  // ─── Actions ──────────────────────────────────────────────────────────────
  const resetConstructor = () => {
    setEditingDraftId(null);
    setParsedContent(null);
    setAiProcessedText('');
    setSelectedImages([]);
    setSelectedVideo(null);
    setMediaPaths([]);
    setVideoPath(null);
    setMainImage('');
    setPostButtons([]);
  };

  const abortCtrl = useRef<AbortController | null>(null);
  const processAI = async () => {
    if (!originalText) return;
    abortCtrl.current?.abort();
    abortCtrl.current = new AbortController();

    setIsProcessingAI(true);
    setLastError(null);

    const answer = await aiServiceInstance.processText(
      originalText,
      aiKeys,
      serverStatus?.preferredProvider ?? 'gemini',
      (msg) => addClientLog(msg),
      abortCtrl.current.signal
    );

    if (answer.success) {
      setAiProcessedText(answer.result);
      setHtmlProcessed(mdToTelegramHtml(answer.result));
      setSubmitMsg({ type: 'success', text: `Ответ от ${answer.provider}` });
    } else if (answer.error !== 'The user aborted a request.') {
      addClientLog(`❌ AI Error: ${answer.error}`);
      setLastError(`❌ ${answer.provider}: ${answer.error}`);
    }
    
    setIsProcessingAI(false);
  };

  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages(prev => {
      if (prev.includes(imageUrl)) return prev.filter(i => i !== imageUrl);
      if (prev.length >= 9) { setLastError('Максимум 9 изображений'); return prev; }
      return [...prev, imageUrl];
    });
  };

  const saveDraft = useCallback(async (draftStatus: 'draft' | 'scheduled'): Promise<string | undefined> => {
    const currentText = aiProcessedText;
    if (!currentText || isActionInProgress) { if (!currentText) setLastError('Введите текст поста'); return; }
    if (draftStatus === 'scheduled' && !scheduleDateTime) { setLastError('Выберите дату публикации'); return; }

    setIsActionInProgress(true);
    const draftId = editingDraftId || Date.now().toString();
    const draft: DraftPost = {
      id: draftId, parsedContent: parsedContent || undefined, 
      selectedImages, // thumbnails
      selectedVideo: selectedVideo || undefined,
      mediaPaths, // High-res images
      videoPath: videoPath || undefined,
      mainImage: mainImage || undefined,
      text: currentText, buttons: postButtons.map(b => ({ ...b, url: b.url.startsWith('http') ? b.url : 'https://' + b.url })),
      status: draftStatus,
      scheduledAt: draftStatus === 'scheduled' && scheduleDateTime ? new Date(scheduleDateTime).getTime() : undefined,
      createdAt: editingDraftId ? (drafts.find(d => d.id === editingDraftId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };

    try {
      addClientLog(`💾 Сохранение черновика: ${draftStatus}`);
      await saveDraftHook(draft);
      if (draftStatus === 'scheduled' && !isStandalone) {
        const cleanUrl = getCleanBaseUrl();
        if (cleanUrl) await universalFetch(`${cleanUrl}/api/posts/schedule`, { method: 'POST', body: draft });
      }
      setSubmitMsg({ type: 'success', text: draftStatus === 'scheduled' ? 'Пост запланирован!' : 'Черновик сохранен!' });
      if (draftStatus === 'draft') setEditingDraftId(draftId);
      else { setIsConstructorOpen(false); resetConstructor(); }
      reloadDrafts();
      return draftId;
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); return undefined; }
    finally { setIsActionInProgress(false); }
  }, [isActionInProgress, aiProcessedText, editingDraftId, parsedContent, selectedImages, selectedVideo, mediaPaths, videoPath, mainImage, postButtons, scheduleDateTime, drafts, isStandalone, getCleanBaseUrl, universalFetch, saveDraftHook, reloadDrafts]);

  const handlePublish = useCallback(async () => {
    if (isActionInProgress) return;
    let currentText = aiProcessedText;
    if (!currentText) { setLastError('Введите текст поста'); return; }

    const htmlText = htmlProcessed || mdToTelegramHtml(currentText);

    // Character limit check
    const limit = (selectedImages.length > 0 || !!selectedVideo) ? 1024 : 4096;
    if (htmlText.length > limit) {
      setLastError(`Лимит символов после обработки: ${htmlText.length} / ${limit}`);
      return;
    }

    setIsActionInProgress(true);
    addClientLog(`🚀 Публикация поста: ${currentText.substring(0, 30)}...`);
    try {
      const post: DraftPost = {
        id: editingDraftId || Date.now().toString(), text: currentText, 
        selectedImages, selectedVideo: selectedVideo || undefined,
        mediaPaths, videoPath: videoPath || undefined,
        mainImage: mainImage || undefined, buttons: postButtons.map(b => ({ ...b, url: b.url.startsWith('http') ? b.url : 'https://' + b.url })),
        status: 'published', createdAt: Date.now(), updatedAt: Date.now()
      };

      if (isStandalone) {
        if (!botToken || !tempChatId) throw new Error("Токен бота или Chat ID не настроены");
        
        const extra: any = { parse_mode: 'HTML' };
        if (post.buttons && post.buttons.length > 0) {
          const vb = post.buttons.filter(b => b.text?.trim() && b.url?.trim() && b.url !== 'https://').map(b => [{ text: b.text, url: b.url }]);
          if (vb.length > 0) extra.reply_markup = { inline_keyboard: vb };
        }

        // ПОДГОТОВКА МЕДИА из путей на диске
        addClientLog(`🎞️ Загрузка медиа: ${post.mediaPaths?.length || 0} фото, ${post.videoPath ? '1 видео' : 'нет видео'}`);
        const highResImages = await Promise.all((post.mediaPaths || []).map(p => storage.loadMedia(p)));
        const highResVideo = post.videoPath ? await storage.loadMedia(post.videoPath) : null;

        // Standalone publishing
        if (highResImages.length === 0 && !highResVideo) {
          await telegramClient?.sendMessage(tempChatId, htmlText, extra);
        } else if (highResImages.length === 1 && !highResVideo) {
          await telegramClient?.sendPhoto(tempChatId, highResImages[0], { ...extra, caption: htmlText });
        } else if (highResImages.length === 0 && highResVideo) {
          await telegramClient?.sendVideo(tempChatId, highResVideo, { ...extra, caption: htmlText });
        } else {
          const mediaItems: any[] = [];
          if (highResVideo) {
            mediaItems.push({ type: 'video', media: highResVideo, caption: htmlText, parse_mode: 'HTML' });
          }
          highResImages.forEach((img, i) => {
             mediaItems.push({
               type: 'photo', media: img,
               caption: !highResVideo && i === 0 ? htmlText : undefined,
               parse_mode: !highResVideo && i === 0 ? 'HTML' : undefined
             });
          });
          await telegramClient?.sendMediaGroup(tempChatId, mediaItems);
          if (post.buttons?.length) await telegramClient?.sendMessage(tempChatId, "👇 Действия:", extra);
        }
        
        await savePublishedPost(post);
        setSubmitMsg({ type: 'success', text: 'Пост опубликован!' });
        setIsConstructorOpen(false); resetConstructor(); setIsPublishedOpen(true);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) throw new Error("Сервер не настроен");
        const res = await universalFetch(`${cleanUrl}/api/posts/publish`, { method: 'POST', body: post });
        
        if (res.ok) {
          setSubmitMsg({ type: 'success', text: 'Пост опубликован!' });
          setIsConstructorOpen(false); resetConstructor(); loadDrafts(); loadPublishedPosts(); setIsPublishedOpen(true);
        } else { const err = await res.json(); setLastError(`Ошибка: ${err.error}`); }
      }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsActionInProgress(false); }
  }, [isActionInProgress, aiProcessedText, htmlProcessed, editingDraftId, selectedImages, selectedVideo, mediaPaths, videoPath, mainImage, postButtons, isStandalone, botToken, tempChatId, telegramClient, mdToTelegramHtml, getCleanBaseUrl, universalFetch, loadDrafts, loadPublishedPosts, loadAllStandaloneData, savePublishedPost]);

  const publishDraft = useCallback(async (draftId: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      let draft = drafts.find(d => d.id === draftId) || scheduledPosts.find(d => d.id === draftId);
      if (!draft) throw new Error("Черновик не найден");

      let textToPublish = draft.text;
      const htmlText = mdToTelegramHtml(textToPublish);
      const postToPublish = { ...draft, text: textToPublish };

      if (isStandalone) {
        if (!tempChatId) throw new Error("Chat ID не настроен");
        const extra: any = { parse_mode: 'HTML' };
        if (postToPublish.buttons && postToPublish.buttons.length > 0) {
          const vb = postToPublish.buttons.filter(b => b.text?.trim() && b.url?.trim() && b.url !== 'https://').map(b => [{ text: b.text, url: b.url }]);
          if (vb.length > 0) extra.reply_markup = { inline_keyboard: vb };
        }

        // LOAD HIGH RES MEDIA
        const highResImages = await Promise.all((postToPublish.mediaPaths || []).map(p => storage.loadMedia(p)));
        const highResVideo = postToPublish.videoPath ? await storage.loadMedia(postToPublish.videoPath) : null;

        if (highResImages.length === 0 && !highResVideo) {
          await telegramClient?.sendMessage(tempChatId, htmlText, extra);
        } else if (highResImages.length === 1 && !highResVideo) {
          await telegramClient?.sendPhoto(tempChatId, highResImages[0], { ...extra, caption: htmlText });
        } else if (highResImages.length === 0 && highResVideo) {
          await telegramClient?.sendVideo(tempChatId, highResVideo, { ...extra, caption: htmlText });
        } else {
          const mediaItems: any[] = [];
          if (highResVideo) {
            mediaItems.push({ type: 'video', media: highResVideo, caption: htmlText, parse_mode: 'HTML' });
          }
          highResImages.forEach((img, i) => {
            mediaItems.push({
              type: 'photo', media: img,
              caption: !highResVideo && i === 0 ? htmlText : undefined,
              parse_mode: !highResVideo && i === 0 ? 'HTML' : undefined
            });
          });
          await telegramClient?.sendMediaGroup(tempChatId, mediaItems);
          if (postToPublish.buttons?.length) await telegramClient?.sendMessage(tempChatId, "👇 Действия:", extra);
        }

        // Move to published
        await savePublishedPost({ ...postToPublish, status: 'published', updatedAt: Date.now() });
        await deleteDraftHook(draftId);
        
        loadAllStandaloneData();
        setSubmitMsg({ type: 'success', text: 'Опубликовано!' });
        setIsPublishedOpen(true);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) throw new Error("Сервер не настроен");
        const res = await universalFetch(`${cleanUrl}/api/posts/publish`, { method: 'POST', body: postToPublish });
        if (res.ok) { 
          setSubmitMsg({ type: 'success', text: 'Опубликовано!' }); 
          loadDrafts(); loadPublishedPosts(); setIsPublishedOpen(true); 
        } else { const err = await res.json(); setLastError(`Ошибка: ${err.error}`); }
      }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsActionInProgress(false); }
  }, [isActionInProgress, drafts, scheduledPosts, mdToTelegramHtml, isStandalone, botToken, tempChatId, telegramClient, loadAllStandaloneData, getCleanBaseUrl, universalFetch, loadDrafts, loadPublishedPosts, savePublishedPost, deleteDraftHook]);
  const deleteDraft = async (draftId: string) => {
    try {
      await deleteDraftHook(draftId);
      if (!isStandalone) loadScheduledPosts();
    } catch (e) { console.error(e); }
  };


  const runDiagnostics = async () => {
    setIsDiagnosticsRunning(true);
    addClientLog("🔍 Запуск расширенной диагностики...");
    
    const targets = [
      { name: "Google", url: "https://www.google.com" },
      { name: "Telegram", url: "https://api.telegram.org" },
      { name: "Cloudflare IP (1.1.1.1)", url: "https://1.1.1.1" },
    ];

    addClientLog("🌐 Проверка публичного IP...");
    try {
      const res = await fetch("https://api.ipify.org?format=json", { cache: 'no-cache' });
      const data = await res.json();
      addClientLog(`🌍 Ваш IP в приложении: ${data.ip}`);
    } catch (e: any) {
      addClientLog(`❌ Не удалось определить IP. Приложение Off-line.`);
    }

    for (const target of targets) {
      addClientLog(`🔌 Проверка ${target.name} (Web Fetch)...`);
      try {
        const start = Date.now();
        await fetch(target.url, { mode: 'no-cors', cache: 'no-cache' });
        addClientLog(`✅ ${target.name}: Доступен (${Date.now() - start}ms)`);
      } catch (e: any) {
        addClientLog(`❌ ${target.name}: Ошибка. ${e.message}`);
      }
    }
    
    if (isNative()) {
       addClientLog(`📱 Проверка Native HTTP...`);
       try {
         // Прямой IP одного из серверов Telegram (Data Center 4)
         const res = await CapacitorHttp.request({ url: 'https://149.154.167.220', method: 'GET', connectTimeout: 10000 });
         addClientLog(`✅ Native Direct (149.154.167.220): Статус ${res.status}`);
       } catch (e: any) {
         addClientLog(`❌ Native Direct: ОШИБКА. ${e.message}`);
       }
    }

    setIsDiagnosticsRunning(false);
    addClientLog("🏁 Диагностика завершена.");
  };

  const handleDeleteTemplate = async (idOrName: string) => {
    try {
      if (isStandalone) {
        const currentTemplates = await storage.loadJson('templates.json', []);
        await storage.saveJson('templates.json', currentTemplates.filter((t: any) => t.id !== idOrName && t.name !== idOrName));
        loadAllStandaloneData();
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/templates/buttons/${encodeURIComponent(idOrName)}`, { method: 'DELETE' });
        loadButtonTemplates();
      }
    } catch (e) { console.error(e); }
  };

  const openFolderBrowser = async (startPath?: string) => {
    setIsBrowserLoading(true);

    if (isStandalone) {
      if (isNative()) {
        try {
          const current = startPath || ""; // empty means ExternalStorage root
          const result = await Filesystem.readdir({
            path: current,
            directory: Directory.ExternalStorage
          });
          
          const dirs = result.files
            .filter(f => f.type === 'directory' || !f.name.includes('.')) // fallback for early Capacitor versions
            .sort((a,b) => a.name.localeCompare(b.name))
            .map(f => ({
              name: f.name,
              path: current ? `${current}/${f.name}` : f.name
            }));
            
          setBrowserPath(current || "/ (Корень хранилища)");
          setBrowserDirs(dirs);
          
          let parent: string | null = null;
          if (current) {
            const lastSlash = current.lastIndexOf('/');
            parent = lastSlash !== -1 ? current.substring(0, lastSlash) : "";
          }
          setBrowserParent(parent);
          setShowFolderBrowser(true);
        } catch(e: any) {
          setLastError(`Ошибка обзора папок: ${e.message}`);
        } finally {
          setIsBrowserLoading(false);
        }
      } else {
        setLastError("Обзор папок доступен только на устройстве Android.");
        setIsBrowserLoading(false);
      }
      return;
    }

    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) { setIsBrowserLoading(false); return; }
    try {
      const url = `${cleanUrl}/api/utils/list-dirs${(startPath?.trim()) ? `?path=${encodeURIComponent(startPath)}` : ''}`;
      const res = await universalFetch(url);
      if (res.ok) {
        const data = await res.json();
        setBrowserPath(typeof data?.currentPath === 'string' ? data.currentPath : '');
        setBrowserDirs(Array.isArray(data?.dirs) ? data.dirs : []);
        setBrowserParent((typeof data?.parentPath === 'string' && data.parentPath !== data.currentPath) ? data.parentPath : null);
        setShowFolderBrowser(true);
      }
    } catch (e: any) { setLastError(`Ошибка браузера: ${e.message}`); } finally { setIsBrowserLoading(false); }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsActionInProgress(true);
    setSubmitMsg({ type: 'success', text: `Файлов: ${files.length}. Обработка...` });
    try {
      const newThumbnails: string[] = [];
      const newPaths: string[] = [];
      let newVideoThumb: string | null = null;
      let newVideoPath: string | null = null;
      for (const file of Array.from(files) as File[]) {
        const fileId = `${Date.now()}_${Math.round(Math.random() * 1000)}`;
        const ext = file.name.split('.').pop() || 'tmp';
        const diskName = `${fileId}.${ext}`;
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        if (file.type.startsWith('video/')) {
           if (newVideoPath) continue; 
           if (isStandalone) newVideoPath = await storage.saveMedia(`video_${diskName}`, base64);
           newVideoThumb = "https://cdn-icons-png.flaticon.com/512/1179/1179069.png";
           continue;
        }
        if (!file.type.startsWith('image/')) continue;
        if (isStandalone) {
          const savedPath = await storage.saveMedia(`img_${diskName}`, base64);
          newPaths.push(savedPath);
        }
        const thumbBase64 = await new Promise<string>((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const SIZE = 200;
            const scroll = Math.min(img.width, img.height);
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            const x = (img.width - scroll) / 2;
            const y = (img.height - scroll) / 2;
            ctx?.drawImage(img, x, y, scroll, scroll, 0, 0, SIZE, SIZE);
            resolve(canvas.toDataURL('image/jpeg', 0.5));
          };
          img.src = base64;
        });
        newThumbnails.push(thumbBase64);
      }
      setSelectedImages(prev => [...prev, ...newThumbnails].slice(-10));
      setMediaPaths(prev => [...prev, ...newPaths].slice(-10));
      if (newVideoThumb) setSelectedVideo(newVideoThumb);
      if (newVideoPath) setVideoPath(newVideoPath);
      setSubmitMsg({ type: 'success', text: 'Медиа сохранено' });
    } catch (e: any) {
      setLastError(`Ошибка загрузки: ${e.message}`);
    } finally {
      setIsActionInProgress(false);
      e.target.value = '';
    }
  };

  const saveChatIdPresets = async (newPresets: string[]) => {
    if (isStandalone) {
      await storage.setSetting('chat_id_presets', JSON.stringify(newPresets));
      setChatIdPresets(newPresets);
      return;
    }
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    try {
      await universalFetch(`${cleanUrl}/api/config/chat-id-presets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { presets: newPresets } });
      setChatIdPresets(newPresets);
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); }
  };

  const handleSaveChatId = useCallback(async () => {
    if (isStandalone) {
      await storage.setSetting('chat_id', tempChatId);
      setSubmitMsg({ type: 'success', text: 'ID сохранен локально!' });
      loadAllStandaloneData();
      return;
    }
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    setIsSavingToken(true);
    try {
      const res = await universalFetch(`${cleanUrl}/api/config/chat-id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { chatId: tempChatId } });
      if (res.ok) { setSubmitMsg({ type: 'success', text: 'ID сохранен!' }); safeLocalStorage.setItem('tg_bot_chat_id', tempChatId); refetchStatus(); }
      else { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ошибка'); }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsSavingToken(false); }
  }, [isStandalone, tempChatId, getCleanBaseUrl, loadAllStandaloneData, refetchStatus]);

  const handleDeleteToken = async () => {
    try {
      if (isStandalone) {
        updateSetting('standalone_bot_token', '');
        await storage.setSecure('bot_token', '');
        setSubmitMsg({ type: 'success', text: 'Standalone токен удален.' });
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/config/clear-token`, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {}
        });
        if (res.ok) { 
          updateSetting('server_bot_token', '');
          await storage.setSetting('server_bot_token', '');
          setSubmitMsg({ type: 'success', text: 'Серверный токен удален.' }); 
          refetchStatus(); 
        }
      }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); }
  };

  const handleSendTestMessage = async () => {
    try {
      if (isStandalone) {
        if (!botToken || !tempChatId) throw new Error("Токен или Chat ID не настроены");
        await telegramClient?.sendMessage(tempChatId, "✅ <b>Тест Standalone успешен!</b>");
        setSubmitMsg({ type: 'success', text: 'Тест отправлен!' });
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/test-telegram`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { token: botToken, chatId: tempChatId } });
        
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const htmlText = await res.text().catch(() => '');
          if (htmlText.includes('security cookie') || htmlText.includes('Action required') || htmlText.includes('AI Studio')) {
            throw new Error("Доступ заблокирован. Используйте URL Cloud Run для мобильного приложения.");
          }
        }

        if (res.ok) setSubmitMsg({ type: 'success', text: 'Тест отправлен!' });
        else { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ошибка'); }
      }
    } catch (e: any) { setSubmitMsg({ type: 'error', text: `Ошибка: ${e.message}` }); }
  };

  const handleSaveSettings = async () => {
    setIsSubmitting(true); setSubmitMsg(null);
    try {
      let cleanUrl = '';
      if (tempBaseUrl) {
        if (/\s/.test(tempBaseUrl.trim())) throw new Error("URL содержит пробелы.");
        cleanUrl = getCleanBaseUrl(tempBaseUrl) || '';
      }

      if (!isStandalone && !cleanUrl) {
        throw new Error("Для серверного режима необходим корректный URL");
      }

      setBaseUrl(cleanUrl);
      setTempBaseUrl(cleanUrl);
      await Preferences.set({ key: 'tg_bot_server_url', value: cleanUrl });
      
      // Save token to secure storage
      if (isStandalone) {
        await storage.setSecure('bot_token', botToken);
      } else {
        await storage.setSetting('server_bot_token', botToken);
      }
      
      if (cleanUrl) {
        await storage.setSecure('base_url', cleanUrl);
      }

      if (!isStandalone && cleanUrl) {
        const res = await universalFetch(`${cleanUrl}/api/config/token`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: { token: botToken } 
        });
        
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const htmlText = await res.text().catch(() => '');
          if (htmlText.includes('security cookie') || htmlText.includes('Action required') || htmlText.includes('AI Studio')) {
            // Warn but allow continue for testing purposes in web
            setSubmitMsg({ type: 'error', text: "URL Preview обнаружен. API сервера может быть ограничен." });
          }
        }

        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Ошибка ${res.status}`); }
      }
      
      setSubmitMsg({ type: 'success', text: 'Настройки сохранены!' });
      setTimeout(() => setShowSettings(false), 2000);
    } catch (err: any) { setSubmitMsg({ type: 'error', text: err.message || 'Ошибка сохранения' }); }
    finally { setIsSubmitting(false); if (!isStandalone) refetchStatus(); }
  };

  const testConnection = async () => {
    setIsTestingConnection(true); setSubmitMsg(null);
    try {
      if (/\s/.test((tempBaseUrl || '').trim())) throw new Error("URL содержит пробелы. Вставьте адрес без переносов и пробелов.");
      const cleanUrl = getCleanBaseUrl(tempBaseUrl);
      if (!cleanUrl) throw new Error("Некорректный URL");
      const res = await universalFetch(`${cleanUrl}/api/ping`);
      
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        const htmlText = await res.text().catch(() => '');
        if (htmlText.includes('security cookie') || htmlText.includes('Action required') || htmlText.includes('AI Studio')) {
          const msg = "Обнаружен URL предварительного просмотра AI Studio. В этом режиме API может быть заблокирован (нужна авторизация через браузер). Для мобильного приложения Android ОБЯЗАТЕЛЬНО разверните сервер через 'Deploy to Cloud Run' и используйте полученный URL.";
          setSubmitMsg({ type: 'error', text: msg });
          // Не блокируем сохранение, но предупреждаем
          return;
        } else {
          throw new Error("Сервер вернул HTML вместо JSON. Убедитесь, что вы используете корректный URL Cloud Run.");
        }
      }
      
      if (res.ok) setSubmitMsg({ type: 'success', text: 'Соединение установлено!' });
      else throw new Error(`Ошибка: ${res.status}`);
    } catch (err: any) { setSubmitMsg({ type: 'error', text: `Ошибка: ${err.message}` }); }
    finally { setIsTestingConnection(false); }
  };

  const testNetwork = async () => {
    setIsTestingNet(true); setNetTestResult('Тестирование...');
    try {
      const res = await fetch('https://api.github.com', { method: 'GET' });
      setNetTestResult(res.ok ? '✅ Интернет доступен' : `❌ Ошибка: ${res.status}`);
    } catch (e: any) { setNetTestResult(`❌ Нет интернета: ${e.message}`); }
    finally { setIsTestingNet(false); }
  };

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) { await window.aistudio?.openSelectKey?.(); setNeedsKey(false); }
  };

  // ✅ Мемоизация props объектов для PostConstructor
  const constructorProps = useMemo(() => ({
    isOpen: isConstructorOpen,
    onClose: () => setIsConstructorOpen(false),
    isConstructorOpen,
    setIsConstructorOpen,
    parsedContent,
    setParsedContent,
    aiProcessedText,
    setAiProcessedText,
    selectedImages,
    setSelectedImages,
    selectedVideo,
    setSelectedVideo,
    syncedImages,
    mainImage,
    setMainImage,
    postButtons,
    setPostButtons,
    originalText,
    setOriginalText,
    isProcessingAI,
    processAI,
    showTemplates,
    setShowTemplates,
    buttonTemplates,
    handleDeleteTemplate,
    saveButtonTemplate: () => saveButtonTemplate(templateName, postButtons),
    templateName,
    setTemplateName,
    imagePath,
    setImagePath,
    openFolderBrowser,
    isBrowserLoading,
    saveImagePath: handleSaveImagePath,
    handleFolderSelect,
    syncLocalImages,
    isActionInProgress,
    sensors,
    handleDragEnd,
    toggleImageSelection,
    scheduleDateTime,
    setScheduleDateTime,
    saveDraft,
    handlePublish,
    submitMsg,
    linkPresets,
    saveLinkPresets,
    SortableImage,
    mediaPaths,
    videoPath,
    deletePublishedPost,
    onEnlarge: (url: string) => setFullScreenImage(url)
  }), [
    isConstructorOpen, parsedContent, aiProcessedText, selectedImages, selectedVideo, mediaPaths, videoPath, mainImage, 
    postButtons, originalText, isProcessingAI, processAI, showTemplates, 
    buttonTemplates, handleDeleteTemplate, saveButtonTemplate, templateName, 
    imagePath, isBrowserLoading, handleSaveImagePath, handleFolderSelect, 
    syncLocalImages, isActionInProgress, sensors, handleDragEnd, 
    toggleImageSelection, scheduleDateTime, saveDraft, handlePublish, 
    submitMsg, linkPresets, saveLinkPresets, SortableImage
  ]);

  // ─── Render ───
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 space-y-6">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full" />
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-white">Загрузка...</h2>
          <p className="text-sm text-neutral-500">{baseUrl || 'Настройте URL сервера'}</p>
        </div>
        <button onClick={() => setLoading(false)} className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs rounded-xl">Пропустить</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-neutral-950/80 backdrop-blur-md border-b border-neutral-800 px-4 py-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Send size={20} className="text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg leading-tight">TG Bot Manager <span className="text-[10px] text-blue-500 font-mono">v{APP_VERSION}</span></h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${isStandalone ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20' : (status?.status === 'online' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/20 text-red-400 border border-red-500/20')}`}>
              {isStandalone ? <Smartphone size={12} /> : status?.status === 'online' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              {isStandalone ? 'Автономно' : status?.status === 'online' ? 'Сервер Онлайн' : 'Сервер Оффлайн'}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${(isStandalone ? isBotOnline : status?.bot === 'active') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : (status?.bot === 'starting' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' : 'bg-red-500/20 text-red-400 border border-red-500/20')}`}>
              {(isStandalone ? isBotOnline : status?.bot === 'active') ? <CheckCircle2 size={12} /> : (status?.bot === 'starting' ? <RefreshCw size={12} className="animate-spin" /> : <AlertCircle size={12} />)}
              {(isStandalone ? (isBotOnline ? 'Бот Онлайн' : 'Бот Оффлайн') : (status?.bot === 'active' ? 'Бот Активен' : status?.bot === 'starting' ? 'Запуск...' : 'Бот Оффлайн'))}
              
              {isStandalone && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setBotRestartCounter(c => c + 1); }}
                  className="ml-1 p-0.5 hover:bg-white/10 rounded transition-all active:scale-95"
                  title="Перезапустить бота"
                >
                  <RefreshCw size={10} className={isBotOnline ? '' : 'animate-spin'} />
                </button>
              )}
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${isProcessingAI ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20' : 'bg-neutral-800 text-neutral-500 border border-neutral-700'}`}>
              <Cpu size={12} className={isProcessingAI ? 'animate-pulse' : ''} />
              ИИ: {isProcessingAI ? 'Обработка' : 'Ожидание'}
            </span>
            {syncedImages.length > 0 && (
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 border border-purple-500/20">
                🖼️ {syncedImages.length} фото
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Tabs Navigation ── */}
      <div className="sticky top-[104px] z-30 bg-neutral-950/80 backdrop-blur-md border-b border-neutral-800 px-4 py-2">
        <div className="max-w-5xl mx-auto">
          <div className="flex gap-1 bg-neutral-900 p-1 rounded-xl">
            {[
              { id: 'editor', label: 'Редактор', icon: Edit2 },
              { id: 'logs', label: 'Логи', icon: Activity },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  activeTab === tab.id 
                    ? 'bg-neutral-800 text-white shadow-lg border border-neutral-700' 
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <tab.icon size={14} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        {activeTab === 'editor' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            {/* Server Config Alert */}
            {!isStandalone && !baseUrl && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto text-blue-500"><Settings size={24} /></div>
                <h3 className="text-lg font-bold text-white">Требуется настройка</h3>
                <p className="text-neutral-400 text-sm">Нажмите на иконку настроек в правом верхнем углу и введите URL вашего сервера</p>
                <button onClick={() => setShowSettings(true)} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all">Открыть настройки</button>
              </div>
            )}

            {/* Post Constructor Button */}
            <div className="bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden shadow-xl">
              <button onClick={() => setIsConstructorOpen(true)} className="w-full px-6 py-8 flex items-center justify-between hover:bg-neutral-800/50 transition-colors group">
                <div className="flex items-center gap-5">
                  <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform"><Edit2 size={28} /></div>
                  <div className="text-left">
                    <h2 className="text-xl font-bold text-white">Новая публикация</h2>
                    <p className="text-sm text-neutral-500">Создать пост с Markdown и кнопками</p>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-blue-500 group-hover:bg-blue-600 group-hover:text-white transition-all"><Plus size={24} /></div>
              </button>
            </div>

            {/* Drafts, Scheduled, Published sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-6">
                <CollapsibleSection title="Черновики" icon={FolderOpen} isOpen={!isDraftsCollapsed} onToggle={() => setIsDraftsCollapsed(!isDraftsCollapsed)}>
                  <div className="space-y-3 pt-4">
                    {drafts.length === 0 ? <p className="text-neutral-500 text-center py-8 text-xs italic">Нет черновиков</p> : drafts.map((draft: DraftPost) => (
                      <div key={draft.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between hover:border-neutral-700 transition-colors">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="text-sm font-medium text-white truncate">{draft.text?.split('\n')[0] || 'Без текста'}</p>
                          <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest">{new Date(draft.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingDraftId(draft.id); setParsedContent(draft.parsedContent || null); setAiProcessedText(draft.text || ''); setSelectedImages(draft.selectedImages || []); setSelectedVideo(draft.selectedVideo || null); setMediaPaths(draft.mediaPaths || []); setVideoPath(draft.videoPath || null); setMainImage(draft.mainImage || ''); setPostButtons(draft.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => publishDraft(draft.id)} className="p-2 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg transition-all"><Send size={16} /></button>
                          <button onClick={() => deleteDraft(draft.id)} className="p-2 bg-red-600/10 text-red-400 hover:bg-red-600/30 rounded-lg transition-all"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="Запланированные" icon={Calendar} isOpen={!isScheduledCollapsed} onToggle={() => setIsScheduledCollapsed(!isScheduledCollapsed)}>
                  <div className="space-y-3 pt-4">
                    {scheduledPosts.length === 0 ? <p className="text-neutral-500 text-center py-8 text-xs italic">Нет запланированных</p> : scheduledPosts.map((post: DraftPost) => (
                      <div key={post.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between hover:border-neutral-700 transition-colors">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="text-sm font-medium text-white truncate">{post.text?.split('\n')[0] || 'Без текста'}</p>
                          <p className="text-[10px] text-blue-400 mt-1 flex items-center gap-1 uppercase tracking-widest font-bold"><Clock size={12} />{new Date(post.scheduledAt || '').toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingDraftId(post.id); setAiProcessedText(post.text || ''); setSelectedImages(post.selectedImages || []); setSelectedVideo(post.selectedVideo || null); setMediaPaths(post.mediaPaths || []); setVideoPath(post.videoPath || null); setMainImage(post.mainImage || ''); setPostButtons(post.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Edit2 size={16} /></button>
                          <button onClick={() => deleteDraft(post.id)} className="p-2 bg-red-600/10 text-red-400 rounded-lg"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              </div>

              <div className="space-y-6">
                <CollapsibleSection title={`Опубликованные (${publishedPosts.length})`} icon={CheckCircle2} isOpen={isPublishedOpen} onToggle={() => setIsPublishedOpen(!isPublishedOpen)}>
                  <div className="space-y-3 pt-4">
                    {publishedPosts.length === 0 ? <p className="text-neutral-500 text-center py-8 text-xs italic">Нет опубликованных</p> : publishedPosts.map((post: DraftPost, idx: number) => (
                      <div key={post.id || idx} className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4 flex items-center justify-between hover:border-neutral-700 transition-colors opacity-80">
                        <div className="flex-1 min-w-0 pr-4">
                          <p className="text-sm font-medium text-neutral-300 truncate">{post.text?.split('\n')[0] || 'Без текста'}</p>
                          <p className="text-[10px] text-emerald-400 mt-1 uppercase tracking-widest font-bold">{post.publishedAt ? new Date(post.publishedAt).toLocaleString() : 'Только что'}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingDraftId(null); setAiProcessedText(post.text || ''); setSelectedImages(post.selectedImages || []); setSelectedVideo(post.selectedVideo || null); setMediaPaths(post.mediaPaths || []); setVideoPath(post.videoPath || null); setMainImage(post.mainImage || ''); setPostButtons(post.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Edit2 size={16} /></button>
                          <button onClick={() => deletePublishedPost(post.id)} className="p-2 bg-red-600/10 text-red-400 rounded-lg"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-6 flex flex-col h-[70vh]">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-3"><Activity size={24} className="text-blue-500" /> Системные логи</h2>
                <button onClick={() => setLogs([])} className="text-xs font-bold text-neutral-500 hover:text-red-400 uppercase tracking-widest transition-colors">Очистить</button>
              </div>
              <div className="flex-1 bg-neutral-950 rounded-2xl p-4 overflow-y-auto font-mono text-xs space-y-2 border border-neutral-800 shadow-inner">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-neutral-600 italic">Логи пусты</div>
                ) : logs.map((log: string, idx: number) => (
                  <div key={idx} className={`py-1.5 px-3 rounded-lg border ${
                    log.includes('❌') ? 'text-red-400 bg-red-500/5 border-red-500/10' :
                    log.includes('⚠️') ? 'text-amber-400 bg-amber-500/5 border-amber-500/10' :
                    log.includes('✅') ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/10' :
                    'text-neutral-400 bg-neutral-800/20 border-neutral-800/30'
                  }`}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

        {/* Bot Settings */}
        <CollapsibleSection title="Настройки Telegram Бота" icon={MessageSquare} isOpen={!isBotCollapsed} onToggle={() => setIsBotCollapsed(!isBotCollapsed)}>
          <div className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                  <Key size={10} /> {isStandalone ? 'Standalone Токен' : 'Server Токен'}
                  {botToken && (
                    <span className="ml-auto text-emerald-500 font-mono">Превью: {botToken.substring(0, 5)}...</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input type="password" value={botToken} onChange={e => isStandalone ? updateSetting('standalone_bot_token', e.target.value) : updateSetting('server_bot_token', e.target.value)} placeholder="123456789:ABCDEF..." className="flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono" />
                  {botToken && <button onClick={handleDeleteToken} className="p-2.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 border border-red-500/20" title="Удалить"><Trash2 size={18} /></button>}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2"><Hash size={10} /> ID чата</label>
                <div className="flex gap-2">
                  <input type="text" value={tempChatId} onChange={e => updateSetting('chat_id', e.target.value)} placeholder="-100..." className="flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono" />
                  <button onClick={handleSaveChatId} disabled={isSavingToken || !tempChatId} className="px-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl border border-neutral-700"><Save size={18} /></button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {chatIdPresets.map((preset, i) => (
                    <button key={i} onClick={() => { if (preset) updateSetting('chat_id', preset); else { const p = [...chatIdPresets]; p[i] = tempChatId; saveChatIdPresets(p); } }} className="bg-neutral-800 hover:bg-neutral-700 text-[10px] text-white py-1.5 rounded-lg border border-neutral-700 truncate" title={preset || 'Сохранить текущий'}>
                      {preset || `Пресет ${i + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {status?.botError && <div className="text-[10px] text-red-400 p-2 bg-red-500/10 rounded border border-red-500/20 font-mono">⚠️ {status.botError}</div>}

            <div className="bg-neutral-800/40 rounded-xl p-3 border border-neutral-800/60 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5"><Globe size={10} /> Сетевой режим</span>
                <span className="text-[9px] text-neutral-500 italic">Использовать системный (Native) HTTP</span>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => updateSetting('use_native_http', (!useNativeHttp).toString())}
                  className={`w-10 h-5 rounded-full relative transition-colors ${useNativeHttp ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${useNativeHttp ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <button 
                  onClick={runDiagnostics} 
                  disabled={isDiagnosticsRunning} 
                  className={`p-2 rounded-lg border transition-all ${isDiagnosticsRunning ? 'bg-neutral-800 text-neutral-600 border-neutral-700' : 'bg-blue-600/10 text-blue-400 border-blue-500/20 hover:bg-blue-600/20'}`}
                  title="Диагностика сети"
                >
                  <Activity size={14} className={isDiagnosticsRunning ? 'animate-pulse' : ''} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={async () => {
                if (isStandalone) {
                  if (!botToken) { setLastError('Введите токен для Standalone'); return; }
                  updateSetting('standalone_bot_token', botToken);
                  setSubmitMsg({ type: 'success', text: 'Standalone токен сохранен' });
                  return;
                }
                if (!botToken) { setLastError('Введите токен для Сервера'); return; }
                const cleanUrl = getCleanBaseUrl();
                if (!cleanUrl) { setLastError('Сервер не настроен'); return; }
                setIsSavingToken(true);
                try {
                  updateSetting('server_bot_token', botToken);
                  const res = await universalFetch(`${cleanUrl}/api/config/token`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: { token: botToken } 
                  });
                  if (res.ok) { setSubmitMsg({ type: 'success', text: 'Серверный бот запущен!' }); refetchStatus(); }
                  else { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ошибка'); }
                } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsSavingToken(false); }
              }} disabled={isSavingToken || !botToken} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-sm">
                {isSavingToken ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />} {isStandalone ? 'Сохранить Standalone' : 'Запустить Сервер'}
              </button>
              <button onClick={handleSendTestMessage} disabled={!botToken || (isStandalone ? false : status?.bot !== 'active')} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-sm"><Send size={16} /> Тест</button>
              {!isStandalone && (
                <>
                  <button onClick={async () => { const cleanUrl = getCleanBaseUrl(); if (!cleanUrl) return; try { await universalFetch(`${cleanUrl}/api/bot/restart`, { method: 'POST' }); refetchStatus(); } catch {} }} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm"><RefreshCw size={16} /> Рестарт</button>
                  <button onClick={async () => { const cleanUrl = getCleanBaseUrl(); if (!cleanUrl) return; try { await universalFetch(`${cleanUrl}/api/bot/stop`, { method: 'POST' }); refetchStatus(); } catch {} }} className="px-4 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm"><X size={16} /></button>
                </>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* AI Keys */}
        <CollapsibleSection title="API Ключи ИИ" icon={Key} isOpen={!isAiKeysCollapsed} onToggle={() => setIsAiKeysCollapsed(!isAiKeysCollapsed)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
            {['github', 'openrouter', 'deepseek'].map(provider => (
              <div key={provider} className={`bg-neutral-800/30 border rounded-xl p-3 space-y-2 ${serverStatus?.preferredProvider === provider ? 'border-amber-500/50' : 'border-neutral-800'}`}>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white capitalize">{provider}</label>
                  <button onClick={async () => {
                    if (isStandalone) {
                      await storage.setSetting('preferred_provider', provider);
                      setServerStatus(prev => ({ ...prev, preferredProvider: provider } as any));
                      setSubmitMsg({ type: 'success', text: `Провайдер ${provider} выбран` });
                      return;
                    }
                    const cleanUrl = getCleanBaseUrl();
                    if (!cleanUrl) return;
                    try { await universalFetch(`${cleanUrl}/api/config/api-key`, { method: 'POST', body: { preferredProvider: provider } }); refetchStatus(); } catch {}
                  }} className={`p-1 rounded ${serverStatus?.preferredProvider === provider ? 'bg-amber-500 text-white' : 'bg-neutral-700 text-neutral-400'}`}><Check size={12} /></button>
                </div>
                <div className="flex gap-2">
                  <input type="password" placeholder="Ключ..." value={aiKeys[provider] || ''} onChange={e => updateAiKey(provider, e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none" />
                  <button onClick={async () => {
                    const key = aiKeys[provider];
                    if (!key) return;
                    if (isStandalone) {
                      await storage.setSetting(`api_key_${provider}`, key);
                      setSubmitMsg({ type: 'success', text: 'Ключ сохранен локально' });
                      return;
                    }
                    const cleanUrl = getCleanBaseUrl();
                    if (!cleanUrl) return;
                    try { await universalFetch(`${cleanUrl}/api/config/api-key`, { method: 'POST', body: { apiKey: key, provider } }); setSubmitMsg({ type: 'success', text: 'Сохранено' }); } catch {}
                  }} className="bg-amber-600 hover:bg-amber-500 text-white p-1.5 rounded-lg"><Save size={14} /></button>
                  <button onClick={async () => {
                    const key = aiKeys[provider];
                    if (!key) return;
                    if (isStandalone) {
                      try {
                        await aiServiceInstance.processText("Hello", { [provider]: key }, provider);
                        setSubmitMsg({ type: 'success', text: 'Тест успешен!' });
                      } catch (e: any) { setLastError(e.message); }
                      return;
                    }
                    const cleanUrl = getCleanBaseUrl(tempBaseUrl || baseUrl);
                    if (!cleanUrl) return;
                    try { const res = await universalFetch(`${cleanUrl}/api/test-ai`, { method: 'POST', body: { apiKey: key, provider } }); if (res.ok) setSubmitMsg({ type: 'success', text: 'Тест успешен!' }); else { const err = await res.json(); setLastError(err.error); } } catch (e: any) { setLastError(e.message); }
                  }} className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded-lg"><Activity size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Logs */}
        {/* Upper logs removed as requested */}

      </div>


      {/* ── Fullscreen Logs ── */}
      <AnimatePresence>
        {isLogsFullscreen && (
          <div className="fixed inset-0 z-[100] bg-neutral-950 p-4 md:p-8 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold flex items-center gap-3"><Activity className="text-blue-500" /> Логи сервера</h2>
              <button onClick={() => setIsLogsFullscreen(false)} className="p-3 bg-neutral-900 hover:bg-neutral-800 rounded-full text-neutral-400"><X size={24} /></button>
            </div>
            <div className="flex-1 bg-black rounded-2xl p-6 font-mono text-xs overflow-y-auto border border-neutral-800">
              {logs.map((log, i) => <div key={i} className={`py-1 border-b border-neutral-900/50 ${log.includes('❌') ? 'text-red-400' : log.includes('⚠️') ? 'text-amber-400' : log.includes('✅') ? 'text-emerald-400' : 'text-neutral-400'}`}>{log}</div>)}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Folder Browser Modal ── */}
      <AnimatePresence>
        {showFolderBrowser && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
              <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                <div><h3 className="text-lg font-bold flex items-center gap-2"><FolderOpen className="text-blue-500" size={20} /> Обзор папок</h3><p className="text-[10px] text-neutral-500 truncate mt-1">{browserPath}</p></div>
                <button onClick={() => setShowFolderBrowser(false)} className="p-2 hover:bg-neutral-800 rounded-full"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {browserParent && <button onClick={() => openFolderBrowser(browserParent)} className="w-full flex items-center gap-3 p-3 hover:bg-neutral-800 rounded-xl text-blue-400 text-sm font-bold"><RefreshCw size={16} className="rotate-180" /> .. (Назад)</button>}
                {browserDirs.length === 0 && <p className="text-center py-8 text-neutral-600 text-sm">Папок не найдено</p>}
                {browserDirs.map((dir, idx) => (
                  <div key={idx} className="w-full flex items-center justify-between p-3 hover:bg-neutral-800 rounded-xl group">
                    <div className="flex items-center gap-3 flex-1 cursor-pointer py-1" onClick={() => openFolderBrowser(dir.path)}><Folder className="text-amber-500" size={18} /><span className="text-sm text-neutral-300 group-hover:text-white">{dir.name}</span></div>
                    <button onClick={() => { 
                      setImagePath(dir.path); 
                      setShowFolderBrowser(false); 
                      syncLocalImages(true, dir.path);
                    }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg">Выбрать</button>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-neutral-800 flex justify-between gap-3">
                <button onClick={() => { 
                  setImagePath(browserPath); 
                  setShowFolderBrowser(false); 
                  syncLocalImages(true, browserPath);
                }} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl">Выбрать текущую</button>
                <button onClick={() => setShowFolderBrowser(false)} className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs font-bold rounded-xl">Отмена</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* ── Post Constructor ── */}
      <AnimatePresence>
        {isConstructorOpen && (
          <PostConstructor {...constructorProps} />
        )}
      </AnimatePresence>

      {/* ── Settings Modal ── */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)}
        isStandalone={isStandalone}
        setIsStandalone={setIsStandalone}
        tempBaseUrl={tempBaseUrl}
        setTempBaseUrl={setTempBaseUrl}
        setBaseUrl={setBaseUrl}
        botToken={botToken}
        updateSetting={updateSetting}
        serverStatus={serverStatus}
        getCleanBaseUrl={getCleanBaseUrl}
        universalFetch={universalFetch}
        submitMsg={submitMsg}
        isSubmitting={isSubmitting}
        isTestingConnection={isTestingConnection}
        testConnection={testConnection}
        isTestingNet={isTestingNet}
        testNetwork={testNetwork}
        netTestResult={netTestResult}
        handleSaveSettings={handleSaveSettings}
      />

      {/* ── Full Screen Image ── */}
      <AnimatePresence>
        {fullScreenImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFullScreenImage(null)} className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out">
            <img src={fullScreenImage} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" referrerPolicy="no-referrer" />
            <button className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white"><X size={32} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global submit message */}
      <AnimatePresence>
        {submitMsg && !isConstructorOpen && !showSettings && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl text-sm font-medium flex items-center gap-3 shadow-xl z-[200] ${submitMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {submitMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{submitMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
