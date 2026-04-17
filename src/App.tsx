/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { marked } from 'marked';
import React, { useState, useEffect, useCallback, Component, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, CheckCircle2, AlertCircle, MessageSquare, Cpu, Send, Hash, Key, Settings, Edit2, Save, X, Activity, Trash2, Sparkles, ChevronDown, Image, Calendar, Clock, Plus, Eye, EyeOff, Copy, FolderOpen, Check, Loader2, Folder, GripVertical, Smartphone, Play, Globe, Layout, Palette, Type, Wand2, ClipboardPaste } from 'lucide-react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import MarkdownIt from 'markdown-it';
import { storage, telegram, aiService } from './services/standaloneService';
import { nativeStorage } from './services/nativeStorage';
import { SecureStorage } from './services/secureStorage';
import { useDrafts } from './hooks/useDrafts';
import { useServerConnection } from './hooks/useServerConnection';
import { useImageSync } from './hooks/useImageSync';
import { useButtonTemplates } from './hooks/useButtonTemplates';
import { useScheduledPosts } from './hooks/useScheduledPosts';
import { usePublishedPosts } from './hooks/usePublishedPosts';
import { useAiKeys } from './hooks/useAiKeys';
import { useBotSettings } from './hooks/useBotSettings';
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

// ─── SafeLocalStorage ───────────────────────────────────────────────────────
const safeLocalStorage = {
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

// ─── Helpers ────────────────────────────────────────────────────────────────
const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

const getInitialBaseUrl = () => {
  try {
    if (window.location.href.includes('run.app')) return window.location.origin;
    return safeLocalStorage.getItem('tg_bot_server_url') || '';
  } catch { return ''; }
};

const sanitizeBaseUrlInput = (raw: string): string => {
  return String(raw || '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
};

const normalizeChatIdPresets = (value: unknown): string[] => {
  const presets = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as any).presets))
      ? (value as any).presets
      : [];
  const normalized = presets.slice(0, 3).map((item: any) => String(item ?? '').trim());
  while (normalized.length < 3) normalized.push('');
  return normalized;
};

const shouldPreferHttp = (rawHost: string): boolean => {
  const host = rawHost.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  if (/^(10|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./.test(host)) return true;
  return false;
};

// ─── Components ─────────────────────────────────────────────────────────────
const SortableImage = ({ id, url, isMain, onSelect, onSetMain, onEnlarge }: any) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`relative group aspect-square rounded-lg overflow-hidden border transition-all ${isMain ? 'border-amber-500 shadow-lg ring-2 ring-amber-500/20' : 'border-neutral-800'}`}>
      <div className="w-full h-full cursor-pointer" onClick={() => onEnlarge(url)}>
        <img src={url} alt="Post" className="w-full h-full object-cover pointer-events-none" referrerPolicy="no-referrer" />
      </div>
      {isMain && (
        <div className="absolute top-0 right-0 bg-amber-500 text-neutral-950 text-[6px] font-black px-1.5 py-0.5 rounded-bl-lg uppercase tracking-tighter">
          Main
        </div>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); onSelect(url); }} className="p-1 bg-white/20 hover:bg-white/30 rounded-full text-white" title="Удалить"><Trash2 size={12} /></button>
        {!isMain && <button onClick={(e) => { e.stopPropagation(); onSetMain(url); }} className="p-1 bg-amber-500/80 hover:bg-amber-600 rounded-full text-white" title="Главное"><Check size={12} /></button>}
      </div>
      <div className="absolute top-1 left-1 cursor-grab active:cursor-grabbing p-1 bg-black/50 rounded" {...attributes} {...listeners}><GripVertical size={12} className="text-white" /></div>
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
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const initSettings = async () => {
      const standalone = await Preferences.get({ key: 'setting_is_standalone' });
      setIsStandalone(standalone.value === 'true');
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

  // ─── Universal Fetch ──────────────────────────────────────────────────────
  const universalFetch = useCallback(async (url: string, options: any = {}) => {
    if (!url || url.includes('undefined') || url.includes('null') || url === 'https://' || url === 'http://') {
      throw new Error("INVALID_URL");
    }
    try { const p = new URL(url); if (!p.hostname) throw new Error(); } catch { throw new Error("MALFORMED_URL"); }

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) };

    if (isNative()) {
      let requestData: any = undefined;
      if (options.method && options.method.toUpperCase() !== 'GET' && options.body) {
        try { 
          requestData = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; 
        } catch { 
          requestData = options.body; 
        }
      }
      
      try {
        const response = await CapacitorHttp.request({
          url, 
          method: options.method || 'GET', 
          headers, 
          data: requestData,
          connectTimeout: 60000, 
          readTimeout: 120000,
        });
        
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          json: async () => {
            if (typeof response.data === 'string') {
              try { return JSON.parse(response.data); } catch { return {}; }
            }
            return response.data;
          },
          text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          headers: { get: (name: string) => response.headers?.[name] || response.headers?.[name.toLowerCase()] || null }
        } as any;
      } catch (err: any) {
        throw new Error(err.message || "Native Request Failed");
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error("TIMEOUT_ERROR");
      throw err;
    }
  }, []);

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

  const updateSetting = async (key: string, value: string) => {
    if (key === 'standalone_bot_token' || key === 'server_bot_token') {
      await updateBotSetting(key, value);
    } else if (key === 'setting_is_standalone') {
      setIsStandalone(value === 'true');
      await Preferences.set({ key: 'setting_is_standalone', value });
    } else if (key === 'chat_id') {
      await updateBotSetting('chat_id', value);
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
  const [isWorking, setIsWorking] = useState(false);
  const [fullResponse, setFullResponse] = useState<string | null>(null);
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [isTestingNet, setIsTestingNet] = useState(false);
  const [netTestResult, setNetTestResult] = useState<string | null>(null);
  const [isBotOnline, setIsBotOnline] = useState(false);
  const [botOffset, setBotOffset] = useState(0);
  const [filterRecentImages, setFilterRecentImages] = useState(true);
  const [syncedImages, setSyncedImages] = useState<string[]>([]);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Constructor state
  const [isConstructorOpen, setIsConstructorOpen] = useState(false);
  const [parsedContent, setParsedContent] = useState<ParsedContent | null>(null);
  const [aiProcessedText, setAiProcessedText] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
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
  const { buttonTemplates, setButtonTemplates, loadButtonTemplates } = useButtonTemplates(isStandalone, getCleanBaseUrl, universalFetch);
  const { scheduledPosts, setScheduledPosts, loadScheduledPosts } = useScheduledPosts(isStandalone, getCleanBaseUrl, universalFetch);
  const { publishedPosts, setPublishedPosts, loadPublishedPosts } = usePublishedPosts(isStandalone, getCleanBaseUrl, universalFetch);
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

  const sanitizeForTelegram = (html: string): string => {
    if (!html) return "";
    let s = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/gi, " ")
      .replace(/<\/?(div|p|h[1-6])>/gi, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    const allowed = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler'];
    const placeholders: { tag: string; ph: string }[] = [];
    
    s = s.replace(new RegExp(`<(/?)(${allowed.join('|')})(\\b[^>]*)?>`, 'gi'), (m) => {
      const ph = `__PH_${placeholders.length}__`;
      placeholders.push({ tag: m, ph });
      return ph;
    });

    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    placeholders.forEach(({ tag, ph }) => {
      s = s.replace(ph, tag);
    });

    return s.trim().replace(/\n{3,}/g, "\n\n");
  };
  
  // Convert Markdown to Telegram MarkdownV2 format
  const mdToTelegramMarkdown = useCallback((md: string) => {
    if (!md) return "";

    let result = md;

    // Process line by line to handle different elements
    const lines = result.split('\n');
    const processedLines = lines.map(line => {
      // Handle headers (# Header -> *Header*)
      line = line.replace(/^# (.*$)/g, '*$1*');
      line = line.replace(/^## (.*$)/g, '*$1*');
      line = line.replace(/^### (.*$)/g, '*$1*');

      // Handle bold (**text** -> *text*)
      line = line.replace(/\*\*(.+?)\*\*/g, '*$1*');

      // Handle italic (__text__ or _text_ -> _text_)
      line = line.replace(/__(.+?)__/g, '_$1_');

      // Handle strikethrough (~~text~~ -> ~text~)
      line = line.replace(/~~(.+?)~~/g, '~$1~');

      // Handle spoiler (||text|| -> ||text|| - Telegram supports this natively in MDv2)
      // No conversion needed, Telegram MarkdownV2 supports ||spoiler||

      // Handle code (`code` -> `code`)
      line = line.replace(/`(.+?)`/g, '`$1`');

      // Handle multiline code blocks
      line = line.replace(/```([\s\S]*?)```/g, '```\n$1\n```');

      return line;
    });

    result = processedLines.join('\n');

    // Clean up excessive newlines
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
  }, []);
  const mdToTelegramHtml = useCallback((md: string) => {
    const mdParser = new MarkdownIt({ breaks: true, html: true, linkify: true });
    
    // Custom spoiler rule for ||text||
    mdParser.inline.ruler.before('text', 'spoiler', (state, silent) => {
      const start = state.pos;
      if (state.src.charCodeAt(start) !== 0x7C || state.src.charCodeAt(start + 1) !== 0x7C) return false;
      const match = state.src.slice(start + 2).match(/^([\s\S]+?)\|\|/);
      if (!match) return false;
      if (!silent) {
        state.push('spoiler_open', 'tg-spoiler', 1);
        const t = state.push('text', '', 0);
        t.content = match[1];
        state.push('spoiler_close', 'tg-spoiler', -1);
      }
      state.pos += 4 + match[1].length;
      return true;
    });

    // Replace leading spaces to prevent them from turning into code blocks
    // and correctly preserve manual text indents.
    const preprocessed = md.replace(/^[ \t]+/gm, (match) => '&nbsp;'.repeat(match.length));
    const rawHtml = mdParser.render(preprocessed);
    return sanitizeForTelegram(rawHtml);
  }, []);

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
            const imgUris = imgs.map(i => i.uri);
            setSyncedImages(imgUris);
            setSelectedImages(prev => {
              const combined = [...new Set([...prev, ...imgUris])];
              return combined.slice(-50);
            });
            
            if (imgUris.length > 0 && !mainImage) {
              setMainImage(imgUris[0]);
            }
            
            setParsedContent(prev => ({
              title: prev?.title || '',
              text: prev?.text || '',
              images: imgUris
            }));

            setSubmitMsg({ type: 'success', text: `Синхронизировано ${imgs.length} изображений` });
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
          body: JSON.stringify({ path: pathToUse }) 
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

  const processedTextRef = useRef<HTMLTextAreaElement>(null);
  const constructorMountedRef = useRef(false);  // ✅ FIX: prevent auto-save on mount

  // ─── Logs ─────────────────────────────────────────────────────────────────
  const addClientLog = useCallback((msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] [Client] ${msg}`;
    setLogs(prev => [line, ...prev].slice(0, 50));
  }, []);

  // ─── Fetch Data ───────────────────────────────────────────────────────────
  // ─── Standalone Initialization ───────────────────────────────────────────
  useEffect(() => {
    if (isStandalone) {
      storage.init().then(() => {
        addClientLog("📦 Локальное хранилище инициализировано");
        loadAllStandaloneData();
      });
    }
  }, [isStandalone]);

  const loadAllStandaloneData = async () => {
    const d = await storage.loadJson('drafts.json');
    setDrafts(Array.isArray(d) ? d : []);
    
    const t = await storage.loadJson('templates.json');
    setButtonTemplates(Array.isArray(t) ? t : []);
    
    const p = await storage.loadJson('published.json');
    setPublishedPosts(Array.isArray(p) ? p : []);

    const s = await storage.loadJson('scheduled.json');
    setScheduledPosts(Array.isArray(s) ? s : []);

    // Load settings
    const sToken = await storage.getSetting(isStandalone ? 'standalone_bot_token' : 'server_bot_token');
    if (sToken) updateSetting(isStandalone ? 'standalone_bot_token' : 'server_bot_token', sToken);

    const chatId = await storage.getSetting('chat_id');
    if (chatId) updateSetting('chat_id', chatId);

    const geminiKey = await storage.getSetting('api_key_gemini');
    if (geminiKey) updateAiKey('gemini', geminiKey);
  };

  // ─── Standalone Bot Polling ───────────────────────────────────────────────
  useEffect(() => {
    if (!isStandalone || !botToken) return;

    let isPolling = true;
    const abortController = new AbortController();

    const poll = async () => {
      let offset = botOffset;
      while (isPolling) {
        try {
          const updates = await telegram.getUpdates(botToken, offset, abortController.signal);
          setIsBotOnline(true);
          if (!isPolling) break;
          for (const update of updates) {
            offset = update.update_id + 1;
            setBotOffset(offset);
            if (update.message && update.message.text) {
              addClientLog(`📩 Сообщение от бота: ${update.message.text}`);
              handleStandaloneBotMessage(update.message);
            }
          }
        } catch (e: any) {
          setIsBotOnline(false);
          if (e.name === 'AbortError') break;
          // Telegram often throws errors due to conflict (two processes polling)
          if (e.message?.includes('409') || e.message?.includes('Conflict')) {
            addClientLog("⚠️ Конфликт: Standalone бот запущен в другом месте (возможно на сервере). Выключите серверного бота.");
          } else {
            addClientLog(`⚠️ Ошибка Telegram: ${e.message}`);
          }
        }
        if (isPolling) await new Promise(r => setTimeout(r, 3000));
      }
    };

    poll();
    return () => { 
      isPolling = false; 
      abortController.abort();
    };
  }, [isStandalone, botToken]);

  const handleStandaloneBotMessage = async (message: any) => {
    const text = message.text;
    if (text === '/start') {
      await telegram.sendMessage(botToken, message.chat.id, "✅ Бот запущен автономно!\n\nПришлите текст для публикации.", { parse_mode: 'HTML' });
      return;
    }
    addClientLog(`📝 Обработка текста: ${text.substring(0, 20)}...`);
    // Future: Add AI processing here
  };

  const { status, loading: serverLoading, error: serverError, refetch: refetchStatus } = useServerConnection(isStandalone ? '' : baseUrl);
  
  useEffect(() => {
    const updateStatus = async () => {
      if (status) {
        if (status.botToken) {
          updateSetting('server_bot_token', status.botToken);
          await storage.setSetting('server_bot_token', status.botToken);
        }
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

  // ✅ FIX: Polling logs on Android
  useEffect(() => {
    if (!isNative() || isLogsCollapsed || !baseUrl) return;
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    const poll = async () => {
      try {
        const res = await universalFetch(`${cleanUrl}/api/logs`);
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d?.logs)) setLogs(d.logs.map((log: unknown) => String(log ?? '')).slice().reverse());
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [baseUrl, isLogsCollapsed, getCleanBaseUrl, universalFetch]);

  // ✅ FIX: Load presets only when URL is valid
  useEffect(() => {
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    universalFetch(`${cleanUrl}/api/config/chat-id-presets`)
      .then(r => r.json())
      .then(d => setChatIdPresets(normalizeChatIdPresets(d)))
      .catch(() => {});
  }, [baseUrl, getCleanBaseUrl, universalFetch]);

  // ✅ FIX: Load image path only when URL is valid
  useEffect(() => {
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    universalFetch(`${cleanUrl}/api/config/image-path`).then(r => r.json()).then(d => { if (d.path) { setImagePath(d.path); } }).catch(() => {});
  }, [baseUrl, getCleanBaseUrl, universalFetch]);

  // ✅ FIX: Auto-save image path with debounce and validity check
  useEffect(() => {
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl || !imagePath) return;
    const timer = setTimeout(() => {
      universalFetch(`${cleanUrl}/api/config/image-path`, { method: 'POST', body: JSON.stringify({ path: imagePath }) }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [imagePath, baseUrl, getCleanBaseUrl, universalFetch]);

  // Sync status with chatId
  useEffect(() => {
    if (status?.defaultChatId && !tempChatId) {
      updateSetting('chat_id', String(status.defaultChatId));
      safeLocalStorage.setItem('tg_bot_chat_id', String(status.defaultChatId));
    }
  }, [status]);

  // Load drafts and lists when constructor opens
  useEffect(() => {
    if (isConstructorOpen) {
      loadDrafts();
      loadButtonTemplates();
    }
  }, [isConstructorOpen]);

  // Initial loads
  useEffect(() => {
    loadDrafts();
    loadScheduledPosts();
    loadPublishedPosts();
    loadButtonTemplates();
    safeLocalStorage.removeItem('tg_bot_button_presets');
  }, []);

  // ✅ FIX: Auto-save draft on constructor close — skip first render and check for changes
  useEffect(() => {
    if (!constructorMountedRef.current) { constructorMountedRef.current = true; return; }
    
    if (!isConstructorOpen) {
      const hasChanges = 
        aiProcessedText.trim() !== lastSavedRef.current.text ||
        JSON.stringify(selectedImages) !== JSON.stringify(lastSavedRef.current.images);
      
      if (hasChanges && (aiProcessedText.trim() || selectedImages.length > 0)) {
        saveDraft('draft').then(() => {
          lastSavedRef.current = {
            text: aiProcessedText,
            images: [...selectedImages]
          };
        });
      }
    }
  }, [isConstructorOpen, aiProcessedText, selectedImages]);

  useEffect(() => {
    if (showSettings) { setTempBotToken(botToken); }
  }, [showSettings, botToken]);

  useEffect(() => {
    const init = async () => {
      // Keys are loaded by useAiKeys hook
    };
    init();
  }, []);

  useEffect(() => {
    // Keys are managed by useAiKeys hook and storage/updateAiKey
  }, [aiKeys]);

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

  // ─── Data Loaders ─────────────────────────────────────────────────────────






  // ─── Actions ──────────────────────────────────────────────────────────────
  const resetConstructor = () => {
    setEditingDraftId(null);
    setParsedContent(null);
    setAiProcessedText('');
    setSelectedImages([]);
    setMainImage('');
    setPostButtons([]);
  };

  const lastSavedRef = useRef<{text: string, images: string[]}>({
    text: '',
    images: []
  });

  const processAI = async () => {
    if (!originalText) return;
    setIsProcessingAI(true);
    try {
      let result = '';
      if (isStandalone) {
        const provider = serverStatus?.preferredProvider || 'gemini';
        const apiKey = aiKeys[provider];
        if (!apiKey) throw new Error(`API ключ ${provider} не настроен`);
        const prompt = "Сделай рерайт текста для Телеграм канала. Используй HTML теги (b, i, u, code). Сделай текст привлекательным и структурированным.";
        result = await aiService.processWithAI(originalText, apiKey, prompt, provider);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const r = await universalFetch(`${cleanUrl}/api/process-text`, { 
          method: 'POST', 
          body: JSON.stringify({ 
            text: originalText, 
            provider: serverStatus?.preferredProvider || 'gemini' 
          }) 
        });
        if (r.ok) { 
          const d = await r.json(); 
          if (d.processedText) result = d.processedText; 
        } else {
          const err = await r.json();
          throw new Error(err.error || 'Ошибка сервера при обработке текста');
        }
      }

      if (!result || typeof result !== 'string') {
        throw new Error('Получен пустой или некорректный ответ от AI');
      }

      const errorMarkers = ['⚠️ Ошибка', 'ERROR:', 'Failed to'];
      if (errorMarkers.some(marker => result.startsWith(marker))) {
        throw new Error(`AI вернул ошибку:\n${result}`);
      }

      setAiProcessedText(result);
      setSubmitMsg({ type: 'success', text: 'Текст обработан!' });
    } catch (e: any) { 
      let errorMessage = e.message || String(e);
      let userFriendlyMessage = errorMessage;

      if (errorMessage.includes('quota')) {
        userFriendlyMessage = 'Превышен лимит запросов AI. Попробуйте позже или смените провайдера.';
      } else if (errorMessage.includes('401') || errorMessage.includes('key')) {
        userFriendlyMessage = 'Ошибка API ключа. Проверьте настройки ключей ИИ.';
      }

      addClientLog(`❌ AI Error: ${errorMessage}`);
      setLastError(userFriendlyMessage);
    } finally { setIsProcessingAI(false); }
  };

  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages(prev => {
      if (prev.includes(imageUrl)) return prev.filter(i => i !== imageUrl);
      if (prev.length >= 9) { setLastError('Максимум 9 изображений'); return prev; }
      return [...prev, imageUrl];
    });
  };

  const saveDraft = useCallback(async (draftStatus: 'draft' | 'scheduled'): Promise<string | undefined> => {
    const currentText = processedTextRef.current ? processedTextRef.current.value : aiProcessedText;
    if (!currentText || isActionInProgress) { if (!currentText) setLastError('Введите текст поста'); return; }
    if (draftStatus === 'scheduled' && !scheduleDateTime) { setLastError('Выберите дату публикации'); return; }

    setIsActionInProgress(true);
    const draftId = editingDraftId || Date.now().toString();
    const draft: DraftPost = {
      id: draftId, parsedContent: parsedContent || undefined, selectedImages, mainImage: mainImage || undefined,
      text: currentText, buttons: postButtons.map(b => ({ ...b, url: b.url.startsWith('http') ? b.url : 'https://' + b.url })),
      status: draftStatus,
      scheduledAt: draftStatus === 'scheduled' && scheduleDateTime ? new Date(scheduleDateTime).getTime() : undefined,
      createdAt: editingDraftId ? (drafts.find(d => d.id === editingDraftId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };

    try {
      await saveDraftHook(draft);
      if (draftStatus === 'scheduled' && !isStandalone) {
        const cleanUrl = getCleanBaseUrl();
        if (cleanUrl) await universalFetch(`${cleanUrl}/api/posts/schedule`, { method: 'POST', body: JSON.stringify(draft) });
      }
      setSubmitMsg({ type: 'success', text: draftStatus === 'scheduled' ? 'Пост запланирован!' : 'Черновик сохранен!' });
      if (draftStatus === 'draft') setEditingDraftId(draftId);
      else { setIsConstructorOpen(false); resetConstructor(); }
      reloadDrafts();
      return draftId;
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); return undefined; }
    finally { setIsActionInProgress(false); }
  }, [isActionInProgress, aiProcessedText, editingDraftId, parsedContent, selectedImages, mainImage, postButtons, scheduleDateTime, drafts, isStandalone, getCleanBaseUrl, universalFetch, saveDraftHook, reloadDrafts]);

  const handlePublish = useCallback(async () => {
    if (isActionInProgress) return;
    let currentText = processedTextRef.current ? processedTextRef.current.value : aiProcessedText;
    if (!currentText) { setLastError('Введите текст поста'); return; }

    // Convert Markdown to Telegram MarkdownV2 format for standalone mode
    const mdText = mdToTelegramMarkdown(currentText);
    // Fallback to HTML conversion for server mode
    const htmlText = mdToTelegramHtml(currentText);

    // Character limit check (MarkdownV2 and HTML have similar limits)
    const limit = selectedImages.length > 0 ? 1024 : 4096;
    if (mdText.length > limit) {
      setLastError(`Лимит символов после обработки: ${mdText.length} / ${limit}`);
      return;
    }

    setIsActionInProgress(true);
    try {
      const post = {
        id: editingDraftId || Date.now().toString(), text: currentText, selectedImages,
        mainImage: mainImage || undefined, buttons: postButtons.map(b => ({ ...b, url: b.url.startsWith('http') ? b.url : 'https://' + b.url })),
        status: 'published', createdAt: Date.now(), updatedAt: Date.now()
      };

      if (isStandalone) {
        if (!botToken || !tempChatId) throw new Error("Токен бота или Chat ID не настроены");
        
        // Use MarkdownV2 for standalone mode
        const extra: any = { parse_mode: 'MarkdownV2' };
        if (post.buttons?.length) {
          extra.reply_markup = {
            inline_keyboard: post.buttons.map(b => [{ text: b.text, url: b.url }])
          };
        }

        // Standalone publishing with photos
        if (post.selectedImages.length === 0) {
          await telegram.sendMessage(botToken, tempChatId, mdText, extra);
        } else if (post.selectedImages.length === 1) {
          await telegram.sendPhoto(botToken, tempChatId, post.selectedImages[0], mdText, extra);
        } else {
          // For media group, prepare media items with MarkdownV2 captions
          const mediaItems = post.selectedImages.map((img, i) => ({
            type: 'photo',
            media: img,
            caption: i === 0 ? mdText : undefined,
            parse_mode: i === 0 ? 'MarkdownV2' : undefined
          }));
          await telegram.sendMediaGroup(botToken, tempChatId, mediaItems);
          if (post.buttons?.length) {
             await telegram.sendMessage(botToken, tempChatId, "👇 Действия:", extra);
          }
        }
        
        const currentPublished = await storage.loadJson('published.json', []);
        currentPublished.unshift(post);
        await storage.saveJson('published.json', currentPublished.slice(0, 50));
        
        setSubmitMsg({ type: 'success', text: 'Пост опубликован!' });
        setIsConstructorOpen(false); resetConstructor(); loadAllStandaloneData(); setIsPublishedOpen(true);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) throw new Error("Сервер не настроен");
        const res = await universalFetch(`${cleanUrl}/api/posts/publish`, { method: 'POST', body: JSON.stringify(post) });
        
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const htmlText = await res.text().catch(() => '');
          if (htmlText.includes('security cookie') || htmlText.includes('Action required') || htmlText.includes('AI Studio')) {
            throw new Error("Доступ заблокирован. Используйте URL Cloud Run для мобильного приложения.");
          }
        }

        if (res.ok) {
          setSubmitMsg({ type: 'success', text: 'Пост опубликован!' });
          setIsConstructorOpen(false); resetConstructor(); loadDrafts(); loadPublishedPosts(); setIsPublishedOpen(true);
        } else { const err = await res.json(); setLastError(`Ошибка: ${err.error}`); }
      }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsActionInProgress(false); }
  }, [isActionInProgress, aiProcessedText, editingDraftId, selectedImages, mainImage, postButtons, isStandalone, botToken, tempChatId, telegram, mdToTelegramHtml, getCleanBaseUrl, universalFetch, loadDrafts, loadPublishedPosts, loadAllStandaloneData]);

  const publishDraft = useCallback(async (draftId: string) => {
    if (isActionInProgress) return;
    setIsActionInProgress(true);
    try {
      let draft = drafts.find(d => d.id === draftId) || scheduledPosts.find(d => d.id === draftId);
      if (!draft) throw new Error("Черновик не найден");

      let textToPublish = draft.text;
      // Convert Markdown to Telegram MarkdownV2 for standalone, HTML for server
      const mdText = mdToTelegramMarkdown(textToPublish);
      const htmlText = mdToTelegramHtml(textToPublish);

      const postToPublish = { ...draft, text: textToPublish };

      if (isStandalone) {
        await telegram.sendMessage(botToken, tempChatId, mdText, { parse_mode: 'MarkdownV2' });
        // Move from drafts/scheduled to published
        const currentPublished = await storage.loadJson('published.json', []);
        await storage.saveJson('published.json', [...currentPublished, { ...postToPublish, status: 'published', publishedAt: Date.now() }]);
        
        const currentDrafts = await storage.loadJson('drafts.json', []);
        await storage.saveJson('drafts.json', currentDrafts.filter((d: any) => d.id !== draftId));
        
        const currentScheduled = await storage.loadJson('scheduled.json', []);
        await storage.saveJson('scheduled.json', currentScheduled.filter((d: any) => d.id !== draftId));
        
        loadAllStandaloneData();
        setSubmitMsg({ type: 'success', text: 'Опубликовано автономно!' });
        setIsPublishedOpen(true);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) throw new Error("Сервер не настроен");
        const res = await universalFetch(`${cleanUrl}/api/posts/publish`, { method: 'POST', body: JSON.stringify(postToPublish) });
        if (res.ok) { 
          setSubmitMsg({ type: 'success', text: 'Опубликовано!' }); 
          loadDrafts(); 
          loadPublishedPosts(); 
          setIsPublishedOpen(true); 
        } else { 
          const err = await res.json(); 
          setLastError(`Ошибка: ${err.error}`); 
        }
      }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsActionInProgress(false); }
  }, [isActionInProgress, drafts, scheduledPosts, mdToTelegramMarkdown, mdToTelegramHtml, isStandalone, botToken, tempChatId, telegram, loadAllStandaloneData, getCleanBaseUrl, universalFetch, loadDrafts, loadPublishedPosts]);

  const deleteDraft = async (draftId: string) => {
    try {
      await deleteDraftHook(draftId);
      if (!isStandalone) loadScheduledPosts();
    } catch (e) { console.error(e); }
  };

  const deletePublishedPost = async (id: string) => {
    try {
      if (isStandalone) {
        const currentPublished = await storage.loadJson('published.json', []);
        await storage.saveJson('published.json', currentPublished.filter((p: any) => p.id !== id));
        loadAllStandaloneData();
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/published/${id}`, { method: 'DELETE' });
        loadPublishedPosts();
      }
    } catch (e) { console.error(e); }
  };

  const saveButtonTemplate = async () => {
    if (!templateName || postButtons.length === 0) return;
    try {
      if (isStandalone) {
        const currentTemplates = await storage.loadJson('templates.json', []);
        currentTemplates.push({ id: Date.now().toString(), name: templateName, buttons: postButtons });
        await storage.saveJson('templates.json', currentTemplates);
        setTemplateName('');
        loadAllStandaloneData();
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/posts/templates/buttons`, { method: 'POST', body: JSON.stringify({ name: templateName, buttons: postButtons }) });
        if (res.ok) { setTemplateName(''); loadButtonTemplates(); }
      }
    } catch (e) { console.error(e); }
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
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    setIsBrowserLoading(true);
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
    
    try {
      const images: { name: string, base64: string }[] = [];
      const localBase64: string[] = [];
  
      // 1️⃣ СНАЧАЛА читаем все файлы
      for (const file of Array.from(files) as File[]) {
        if (!file.type.startsWith('image/')) continue;
        
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });
        
        images.push({ name: file.name, base64 });
        localBase64.push(base64);
      }
      
      if (images.length === 0) {
        setLastError('Не найдено изображений для загрузки');
        return;
      }
  
      // 2️⃣ Добавляем в UI НЕМЕДЛЕННО (работает без сервера)
      setParsedContent(prev => {
        const ex = prev?.images || [];
        const combined = [...new Set([...ex, ...localBase64])];
        return prev ? { ...prev, images: combined } : { 
          title: '', 
          text: '', 
          images: combined 
        };
      });
      
      setSelectedImages(prev => {
        const combined = [...new Set([...prev, ...localBase64])];
        return combined.slice(-50);
      });
  
      // 3️⃣ Сохраняем локально (для standalone)
      if (isStandalone) {
        await storage.saveJson('uploaded_images.json', {
          images: localBase64,
          timestamp: Date.now()
        });
        
        setSubmitMsg({ 
          type: 'success', 
          text: `Загружено: ${images.length} фото (локально)` 
        });
        return;
      }
  
      // 4️⃣ Отправляем на сервер ТОЛЬКО если не standalone
      const cleanUrl = getCleanBaseUrl();
      if (cleanUrl) {
        try {
          const res = await universalFetch(`${cleanUrl}/api/upload-images`, {
            method: 'POST',
            body: JSON.stringify({ images, path: imagePath })
          });
          
          if (res.ok) {
            setSubmitMsg({ 
              type: 'success', 
              text: `Загружено: ${images.length} фото (синхронизировано)` 
            });
            await syncLocalImages();
          }
        } catch (err: any) {
          console.warn('Server sync failed:', err);
          setSubmitMsg({ 
            type: 'success', 
            text: `Загружено: ${images.length} фото (только локально)` 
          });
        }
      }
      
    } catch (e: any) {
      setLastError(`Ошибка загрузки: ${e.message}`);
    } finally {
      setIsActionInProgress(false);
    }
  };

  const saveChatIdPresets = async (newPresets: string[]) => {
    const cleanUrl = getCleanBaseUrl();
    if (!cleanUrl) return;
    try {
      await universalFetch(`${cleanUrl}/api/config/chat-id-presets`, { method: 'POST', body: JSON.stringify({ presets: newPresets }) });
      setChatIdPresets(newPresets);
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); }
  };

  const handleSaveChatId = async () => {
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
      const res = await universalFetch(`${cleanUrl}/api/config/chat-id`, { method: 'POST', body: JSON.stringify({ chatId: tempChatId }) });
      if (res.ok) { setSubmitMsg({ type: 'success', text: 'ID сохранен!' }); safeLocalStorage.setItem('tg_bot_chat_id', tempChatId); refetchStatus(); }
      else { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ошибка'); }
    } catch (e: any) { setLastError(`Ошибка: ${e.message}`); } finally { setIsSavingToken(false); }
  };

  const handleDeleteToken = async () => {
    try {
      if (isStandalone) {
        updateSetting('standalone_bot_token', '');
        await storage.setSetting('standalone_bot_token', '');
        setSubmitMsg({ type: 'success', text: 'Standalone токен удален.' });
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/config/clear-token`, { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
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
        await telegram.sendMessage(botToken, tempChatId, "✅ <b>Тест Standalone успешен!</b>");
        setSubmitMsg({ type: 'success', text: 'Тест отправлен!' });
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/test-telegram`, { method: 'POST', body: JSON.stringify({ token: botToken, chatId: tempChatId }) });
        
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
        await SecureStorage.setToken('bot_token', botToken);
      } else {
        await nativeStorage.setToken(botToken);
      }
      
      if (cleanUrl) {
        await SecureStorage.setToken('base_url', cleanUrl);
      }

      if (!isStandalone && cleanUrl) {
        const res = await universalFetch(`${cleanUrl}/api/config/token`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: botToken }) 
        });
        
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          const htmlText = await res.text().catch(() => '');
          if (htmlText.includes('security cookie') || htmlText.includes('Action required') || htmlText.includes('AI Studio')) {
            throw new Error("Доступ заблокирован. Используйте URL Cloud Run.");
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
          throw new Error("Доступ заблокирован. Вы используете URL предварительного просмотра AI Studio. Для работы мобильного приложения необходимо развернуть сервер: Настройки (⚙️) -> 'Deploy to Cloud Run' и использовать полученный URL.");
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
    if (window.aistudio) { await window.aistudio.openSelectKey(); setNeedsKey(false); }
  };

  // ─── Loading screen ───────────────────────────────────────────────────────
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

  // ─── Render ───────────────────────────────────────────────────────────────
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
                <h1 className="font-bold text-lg leading-tight">TG Bot Manager <span className="text-[10px] text-blue-500 font-mono">v5.1.1</span></h1>
                <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Android Control Panel</p>
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
            </span>
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${isWorking ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20' : 'bg-neutral-800 text-neutral-500 border border-neutral-700'}`}>
              <Cpu size={12} className={isWorking ? 'animate-pulse' : ''} />
              ИИ: {isWorking ? 'Обработка' : 'Ожидание'}
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
                          <button onClick={() => { setEditingDraftId(draft.id); setParsedContent(draft.parsedContent || null); setAiProcessedText(draft.text || ''); setSelectedImages(draft.selectedImages || []); setMainImage(draft.mainImage || ''); setPostButtons(draft.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-all"><Edit2 size={16} /></button>
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
                          <button onClick={() => { setEditingDraftId(post.id); setAiProcessedText(post.text || ''); setSelectedImages(post.selectedImages || []); setMainImage(post.mainImage || ''); setPostButtons(post.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Edit2 size={16} /></button>
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
                          <button onClick={() => { setEditingDraftId(null); setAiProcessedText(post.text || ''); setSelectedImages(post.selectedImages || []); setMainImage(post.mainImage || ''); setPostButtons(post.buttons || []); setIsConstructorOpen(true); }} className="p-2 bg-blue-600/10 text-blue-400 rounded-lg"><Edit2 size={16} /></button>
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
                    body: JSON.stringify({ token: botToken }) 
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
            {['gemini', 'github', 'openrouter', 'deepseek'].map(provider => (
              <div key={provider} className={`bg-neutral-800/30 border rounded-xl p-3 space-y-2 ${serverStatus?.preferredProvider === provider ? 'border-amber-500/50' : 'border-neutral-800'}`}>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white capitalize">{provider}</label>
                  <button onClick={async () => {
                    if (isStandalone) {
                      await storage.setSetting('preferred_provider', provider);
                      setSubmitMsg({ type: 'success', text: `Провайдер ${provider} выбран` });
                      return;
                    }
                    const cleanUrl = getCleanBaseUrl();
                    if (!cleanUrl) return;
                    try { await universalFetch(`${cleanUrl}/api/config/api-key`, { method: 'POST', body: JSON.stringify({ preferredProvider: provider }) }); refetchStatus(); } catch {}
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
                    try { await universalFetch(`${cleanUrl}/api/config/api-key`, { method: 'POST', body: JSON.stringify({ apiKey: key, provider }) }); setSubmitMsg({ type: 'success', text: 'Сохранено' }); } catch {}
                  }} className="bg-amber-600 hover:bg-amber-500 text-white p-1.5 rounded-lg"><Save size={14} /></button>
                  <button onClick={async () => {
                    const key = aiKeys[provider];
                    if (!key) return;
                    if (isStandalone) {
                      try {
                        const prompt = "Test connection";
                        await aiService.processWithAI("Hello", key, prompt, provider);
                        setSubmitMsg({ type: 'success', text: 'Тест успешен!' });
                      } catch (e: any) { setLastError(e.message); }
                      return;
                    }
                    const cleanUrl = getCleanBaseUrl(tempBaseUrl || baseUrl);
                    if (!cleanUrl) return;
                    try { const res = await universalFetch(`${cleanUrl}/api/test-ai`, { method: 'POST', body: JSON.stringify({ apiKey: key, provider }) }); if (res.ok) setSubmitMsg({ type: 'success', text: 'Тест успешен!' }); else { const err = await res.json(); setLastError(err.error); } } catch (e: any) { setLastError(e.message); }
                  }} className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded-lg"><Activity size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Logs */}
        <CollapsibleSection title="Логи сервера" icon={Activity} isOpen={!isLogsCollapsed} onToggle={() => setIsLogsCollapsed(!isLogsCollapsed)}>
          <div className="space-y-3 pt-4">
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setIsLogsFullscreen(true)} className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded-lg border border-neutral-700"><Eye size={14} /></button>
              <button onClick={() => setIsLogsPaused(!isLogsPaused)} className={`px-3 py-1 rounded-lg text-[10px] font-bold border ${isLogsPaused ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/50' : 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}>{isLogsPaused ? 'ПАУЗА ВКЛ' : 'ПАУЗА'}</button>
              <button onClick={() => setLogs([])} className="text-[10px] text-neutral-500 hover:text-neutral-300">Очистить</button>
            </div>
            <div className="bg-black/50 rounded-xl p-3 h-48 overflow-y-auto font-mono text-[10px] space-y-0.5 border border-neutral-800">
              {logs.length === 0 ? <p className="text-neutral-700 italic">Ожидание логов...</p> : logs.map((log, i) => (
                <div key={i} className={`py-0.5 ${log.includes('❌') ? 'text-red-400' : log.includes('⚠️') ? 'text-amber-400' : log.includes('✅') ? 'text-emerald-400' : 'text-neutral-400'}`}>{log}</div>
              ))}
            </div>
          </div>
        </CollapsibleSection>

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
          <PostConstructor
            isOpen={isConstructorOpen}
            onClose={() => setIsConstructorOpen(false)}
            isConstructorOpen={isConstructorOpen}
            setIsConstructorOpen={setIsConstructorOpen}
            parsedContent={parsedContent}
            setParsedContent={setParsedContent}
            aiProcessedText={aiProcessedText}
            setAiProcessedText={setAiProcessedText}
            selectedImages={selectedImages}
            setSelectedImages={setSelectedImages}
            mainImage={mainImage}
            setMainImage={setMainImage}
            postButtons={postButtons}
            setPostButtons={setPostButtons}
            originalText={originalText}
            setOriginalText={setOriginalText}
            isProcessingAI={isProcessingAI}
            processAI={processAI}
            showTemplates={showTemplates}
            setShowTemplates={setShowTemplates}
            buttonTemplates={buttonTemplates}
            handleDeleteTemplate={handleDeleteTemplate}
            saveButtonTemplate={saveButtonTemplate}
            templateName={templateName}
            setTemplateName={setTemplateName}
            imagePath={imagePath}
            setImagePath={setImagePath}
            openFolderBrowser={openFolderBrowser}
            isBrowserLoading={isBrowserLoading}
            saveImagePath={handleSaveImagePath}
            handleFolderSelect={handleFolderSelect}
            syncLocalImages={syncLocalImages}
            isActionInProgress={isActionInProgress}
            sensors={sensors}
            handleDragEnd={handleDragEnd}
            toggleImageSelection={toggleImageSelection}
            scheduleDateTime={scheduleDateTime}
            setScheduleDateTime={setScheduleDateTime}
            saveDraft={saveDraft}
            handlePublish={handlePublish}
            submitMsg={submitMsg}
            SortableImage={SortableImage}
            processedTextRef={processedTextRef}
            onEnlarge={(url) => setFullScreenImage(url)}
          />
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
