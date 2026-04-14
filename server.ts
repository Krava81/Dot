import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { Telegraf } from "telegraf";
import axios from "axios";
import * as dotenv from "dotenv";
import { storageWrapper } from './src/services/storageWrapper';
import { FileLogger } from './src/serverUtils';
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { load } from "cheerio";
import { marked } from 'marked';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";

dotenv.config();

const fileLogger = new FileLogger();
const logError = (msg: string) => fileLogger.log('ERROR', msg);
const logWarn = (msg: string) => fileLogger.log('WARN', msg);
const logInfo = (msg: string) => fileLogger.log('INFO', msg);

function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ WARNING: GEMINI_API_KEY is missing. AI features might not work.');
  }
}

validateEnv();

const app = express();
app.set('trust proxy', 1);

// ✅ ПАРСЕРЫ (ОБЯЗАТЕЛЬНО ПЕРВЫМИ!)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ✅ CORS
app.use(cors({
  origin: true, credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Accept","Origin"],
}));

// ✅ RATE LIMITERS
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 50,
  message: { error: "Too many AI requests, please wait" },
  standardHeaders: true, legacyHeaders: false,
});

const mutationRateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100,
  message: { error: "Too many requests, please wait" },
  standardHeaders: true, legacyHeaders: false,
});

const DATA_DIR             = process.cwd();
const TOKEN_FILE           = path.join(DATA_DIR, "bot_token.txt");
const CHAT_ID_FILE         = path.join(DATA_DIR, "chat_id.txt");
const API_KEYS_FILE        = path.join(DATA_DIR, "api_keys.json");
const POSTS_FILE           = path.join(DATA_DIR, "posts.json");
const PUBLISHED_POSTS_FILE = path.join(DATA_DIR, "published_posts.json");
const TEMPLATES_FILE       = path.join(DATA_DIR, "templates.json");
const IMAGE_PATH_FILE      = path.join(DATA_DIR, "image_path.txt");
const CHAT_ID_PRESETS_FILE = path.join(DATA_DIR, "chat_id_presets.json");

// ---- Кеш ----
let cachedApiKeys: ApiKeys        = {};
let cachedPosts: any[]            = [];
let cachedPublishedPosts: any[]   = [];
let cachedTemplates: any          = { buttons: [], reactions: [] };
let cachedImagePath               = "";
let cachedChatIdPresets: string[] = ["", "", ""];

interface ApiKeys {
  gemini?: string; grok?: string; openrouter?: string;
  deepseek?: string; preferredProvider?: string;
}

function readJsonFileSync<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
  }
  return defaultValue;
}

function readPlainFileSync(filePath: string, defaultValue = ""): string {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8").trim();
      if (raw.startsWith('"') && raw.endsWith('"')) {
        try { return JSON.parse(raw); } catch {}
      }
      return raw;
    }
  } catch {}
  return defaultValue;
}

function writeJsonFileSync(filePath: string, data: any): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) { console.error(`Error writing ${filePath}:`, err); }
}

async function loadAllData() {
  cachedApiKeys       = await storageWrapper.readJsonFile<ApiKeys>(API_KEYS_FILE, {});
  cachedPosts         = await storageWrapper.readJsonFile<any[]>(POSTS_FILE, []);
  cachedPublishedPosts = (await storageWrapper.readJsonFile<any[]>(PUBLISHED_POSTS_FILE, [])).map(p => {
    if (!p.id) p.id = uuidv4();
    return p;
  });
  cachedTemplates     = await storageWrapper.readJsonFile(TEMPLATES_FILE, { buttons: [], reactions: [] });
  cachedImagePath     = await storageWrapper.readTextFile(IMAGE_PATH_FILE, "");
  cachedChatIdPresets = await storageWrapper.readJsonFile<string[]>(CHAT_ID_PRESETS_FILE, ["", "", ""]);
  if (!cachedTemplates.buttons)   cachedTemplates.buttons   = [];
  if (!cachedTemplates.reactions) cachedTemplates.reactions = [];
  
  // Force save templates to ensure file exists
  await storageWrapper.writeJsonFile(TEMPLATES_FILE, cachedTemplates);
}

function getPersistentApiKeys(): ApiKeys { return cachedApiKeys; }
async function savePersistentApiKeys(k: ApiKeys) {
  Object.assign(cachedApiKeys, k);
  await storageWrapper.writeJsonFile(API_KEYS_FILE, cachedApiKeys);
}
function getPersistentPosts(): any[] { return cachedPosts; }
async function savePersistentPosts(p: any[]) {
  cachedPosts = p;
  await storageWrapper.writeJsonFile(POSTS_FILE, cachedPosts);
}
function getPersistentPublishedPosts(): any[] { return cachedPublishedPosts; }
async function savePersistentPublishedPosts(p: any[]) {
  cachedPublishedPosts = p;
  await storageWrapper.writeJsonFile(PUBLISHED_POSTS_FILE, cachedPublishedPosts);
}
function getPersistentTemplates(): any { return cachedTemplates; }
async function savePersistentTemplates(t: any) {
  cachedTemplates = t;
  await storageWrapper.writeJsonFile(TEMPLATES_FILE, cachedTemplates);
}
function getPersistentImagePath(): string { return cachedImagePath; }
async function savePersistentImagePath(p: string) {
  cachedImagePath = p;
  await storageWrapper.writeTextFile(IMAGE_PATH_FILE, p);
}
function getPersistentChatIdPresets(): string[] { return cachedChatIdPresets; }
async function savePersistentChatIdPresets(p: string[]) {
  cachedChatIdPresets = p;
  await storageWrapper.writeJsonFile(CHAT_ID_PRESETS_FILE, cachedChatIdPresets);
}

function getPersistentToken(): string {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

async function savePersistentToken(token: string) {
  await storageWrapper.writeTextFile(TOKEN_FILE, token);
}

function getPersistentChatId(): string {
  try {
    if (fs.existsSync(CHAT_ID_FILE)) {
      const id = fs.readFileSync(CHAT_ID_FILE, "utf8").trim();
      if (id) { console.log(`✅ Loaded Chat ID: ${id}`); return id; }
    }
  } catch (e: any) { console.error(`❌ Error reading Chat ID: ${e.message}`); }
  return process.env.DEFAULT_CHAT_ID || "";
}

async function savePersistentChatId(id: string) {
  await storageWrapper.writeTextFile(CHAT_ID_FILE, id);
  console.log(`✅ Saved Chat ID: ${id}`);
}

// ---- Globals ----
let bot: Telegraf | null     = null;
let botError: string | null  = null;
let DEFAULT_CHAT_ID: string | number = "";
let isInitializingBot        = false;
let botRetryTimeout: any = null;
let bot409Retries = 0;
const MAX_409 = 3;
const RETRY_DELAY_MS = 15_000;
const BOT_HEALTHCHECK_MS = 60_000;
const BOT_MAX_HEALTH_FAILS = 3;
let botHealthInterval: any = null;
let botHealthFails = 0;

// Класс для управления логами
class LogManager {
  private logs: string[];
  private readonly maxLogs: number;
  private logClients: Set<Response>;
  private writePointer: number;

  constructor(maxLogs: number = 200) {
    this.logs = new Array(maxLogs);
    this.maxLogs = maxLogs;
    this.logClients = new Set();
    this.writePointer = 0;
  }

  addLog(msg: string): void {
    const timestamp = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const line = `[${timestamp}] ${msg}`;
    
    this.logs[this.writePointer] = line;
    this.writePointer = (this.writePointer + 1) % this.maxLogs;
    
    console.log(line);
    this.broadcastToClients(line);
  }

  private broadcastToClients(line: string): void {
    const deadClients: Response[] = [];
    this.logClients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(line)}\n\n`);
      } catch (error) {
        deadClients.push(client);
      }
    });
    deadClients.forEach(client => this.logClients.delete(client));
  }

  addClient(res: Response): void {
    this.logClients.add(res);
  }

  removeClient(res: Response): void {
    this.logClients.delete(res);
  }

  getLogs(): string[] {
    const result: string[] = [];
    for (let i = this.writePointer - 1; i >= 0; i--) {
      if (this.logs[i]) result.push(this.logs[i]);
    }
    for (let i = this.maxLogs - 1; i >= this.writePointer; i--) {
      if (this.logs[i]) result.push(this.logs[i]);
    }
    return result;
  }
}

const logManager = new LogManager(200);
const addLog = (msg: string) => logManager.addLog(msg);

/**
 * Безопасная санитизация HTML для Telegram
 */
const sanitizeHtml = (text: string): string => {
  if (!text || typeof text !== 'string') return "";
  
  try {
    let s = text
      .replace(/<p>/gi, "")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<ul>/gi, "")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<ol>/gi, "")
      .replace(/<\/ol>/gi, "\n")
      .replace(/<li>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div)>/gi, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    const allowedTags = [
      'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler'
    ];
    
    const placeholders: { tag: string; placeholder: string }[] = [];
    const allowedTagsRegex = new RegExp(`<(/?)(${allowedTags.join('|')})(\\b[^>]*)?>`, 'gi');
    
    s = s.replace(allowedTagsRegex, (match) => {
      const placeholder = `__TAG_${placeholders.length}__`;
      placeholders.push({ tag: match, placeholder });
      return placeholder;
    });

    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    placeholders.forEach(({ tag, placeholder }) => {
      const processedTag = tag.replace(/href="([^"]*)"/gi, (match, url) => {
        const safeUrl = url.replace(/&(?![a-zA-Z0-9#]+;)/g, "&amp;");
        return `href="${safeUrl}"`;
      });
      s = s.replace(placeholder, processedTag);
    });

    s = s.replace(/<\/?(html|body|head|meta|title|doctype|script|style)[^>]*>/gi, "");

    try {
      const $ = load(s, null, false);
      s = $.html();
    } catch (cheerioError) {
      console.warn('Cheerio validation warning:', cheerioError);
    }

    return s.trim().replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/gm, '');
  } catch (error) {
    console.error('❌ HTML sanitization fatal error:', error);
    return text.replace(/<[^>]*>/g, '').trim();
  }
};

app.get("/api/logs/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  logManager.addClient(res);
  
  req.on("close", () => {
    logManager.removeClient(res);
  });
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const VALID_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
] as const;

function isValidModel(model: string): boolean {
  return VALID_GEMINI_MODELS.includes(model as any);
}

// Используем первую модель как дефолтную, если ENV не задан
const DEFAULT_GEMINI_MODEL = VALID_GEMINI_MODELS[0];

function extractRetryDelaySeconds(message: string): number | null {
  if (!message) return null;
  const retryInfoMatch = message.match(/retryDelay\\":\\"(\d+)s\\"/i);
  if (retryInfoMatch?.[1]) return Number(retryInfoMatch[1]);
  const textMatch = message.match(/retry in ([\d.]+)s/i);
  if (textMatch?.[1]) return Math.ceil(Number(textMatch[1]));
  return null;
}

function startBotHealthMonitor(token: string, botInstance: Telegraf) {
  if (botHealthInterval) {
    clearInterval(botHealthInterval);
    botHealthInterval = null;
  }
  botHealthFails = 0;

  botHealthInterval = setInterval(async () => {
    if (bot !== botInstance || isInitializingBot) return;

    try {
      await botInstance.telegram.getMe();
      botHealthFails = 0;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      botHealthFails++;
      addLog(`⚠️ Bot healthcheck failed (${botHealthFails}/${BOT_MAX_HEALTH_FAILS}): ${errMsg}`);

      const shouldRestart = errMsg.includes("409")
        || errMsg.includes("terminated by other getUpdates")
        || botHealthFails >= BOT_MAX_HEALTH_FAILS;

      if (shouldRestart) {
        addLog("♻️ Restarting bot after healthcheck failure...");
        try {
          await initBot(token);
        } catch (err: any) {
          addLog(`❌ Healthcheck restart failed: ${err.message}`);
        }
      }
    }
  }, BOT_HEALTHCHECK_MS);
}

// ---- AI Processing ----
async function processWithAI(text: string, provider?: string, customApiKeys: any = {}): Promise<string> {
  const providers = ["gemini", "github", "deepseek", "openrouter"];
  const saved     = getPersistentApiKeys();
  const effective = provider || saved.preferredProvider || "gemini";
  const ordered   = [effective, ...providers.filter(p => p !== effective)];
  const keys      = { ...saved, ...customApiKeys };
  const disabledProviders = new Set<string>();

  // ✅ ОТЛАДКА: показываем, какие ключи загружены
  addLog(`🔑 Loaded keys: ${Object.keys(keys).filter(k => k !== 'preferredProvider').map(k => `${k}=${keys[k] ? '✓' : '✗'}`).join(', ')}`);
  addLog(`🤖 Выбран ИИ: ${effective.toUpperCase()}`);
  addLog(`📋 Порядок попыток: ${ordered.join(' → ')}`);

  const prompt = `Ты — профессиональный переводчик и новостной редактор.
Твоя главная задача: ПЕРЕВЕСТИ ВЕСЬ ТЕКСТ НА РУССКИЙ ЯЗЫК, ТЫ НЕ ДОЛЖЕН ОСТАВЛЯТЬ КИТАЙСКИЕ ИЕРОГЛИФА В ТЕКСТЕ!, не ищи допполнительную информацию, составляй текст только из того, что получил.

1. Переведи всё на РУССКИЙ.8. Проверь еще раз весь текст, если остались китайские иэрогливы и они не переводятся на русский язык, переводи их на англмйский. Если уже на русском — улучши. Цены/даты на китайском — тоже переводи.
2. Структурируй материал под формат Telegram-поста(Markdown2,что бы обзацы отделялись строкой пустой): раздели на тематические блоки.
3. Напиши цепляющий заголовок на русском — в начале, успользуй все характеристики и данные. 
4. Технические термины (бренды, модели авто, детали) — на английском.
5. Формат: Telegram-пост, подходяции эконки в блоках и эмоции. В конце — хэштеги.
6. НЕ оставляй китайские иероглифы.
7. Форматирование ТОЛЬКО через HTML-теги: <b>жирный</b>, <i>курсив</i>.

ТОЛЬКО готовый текст, без приветствий и подписей. Проверь — нет ли китайских иероглифов.

Текст (первая строка — заголовок):
${text.substring(0, 20000)}`;

  const lastErrors: string[] = [];

  for (let cycle = 1; cycle <= 3; cycle++) {
    if (cycle > 1) addLog(`🔄 AI retry ${cycle}/3...`);

    for (const cur of ordered) {
      if (disabledProviders.has(cur)) continue;
      try {
        // ---- GitHub ----
        if (cur === "github") {
          const apiKey = keys.github || process.env.GITHUB_TOKEN;
          if (!apiKey) { lastErrors.push("GitHub: no key"); continue; }
          const modelName = "gpt-4o-mini";
          addLog(`📡 GitHub Models (${modelName})...`);
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const r = await axios.post(
                "https://models.inference.ai.azure.com/chat/completions",
                {
                  model: modelName,
                  messages: [{ role: "user", content: prompt }],
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
              const responseText = r.data.choices?.[0]?.message?.content;
              if (responseText) {
                addLog("✅ GitHub OK");
                return responseText;
              }
              break;
            } catch (e: any) {
              const status = e.response?.status;
              const errMsg = e.response?.data?.error?.message || e.message;
              
              if (status === 401 || status === 403) {
                addLog(`❌ GitHub auth error: ${errMsg}`);
                lastErrors.push(`GitHub: ${errMsg} (Check token permissions)`);
                break;
              }
              
              if ((status === 429 || status === 503) && attempt < 3) {
                addLog(`⚠️ GitHub ${status}, retry ${attempt}/3...`);
                await sleep(5000 * attempt);
              } else {
                addLog(`❌ GitHub: ${errMsg}`);
                lastErrors.push(`GitHub: ${errMsg}`);
                break;
              }
            }
          }
        }

        // ---- Gemini ----
        else if (cur === "gemini") {
          const apiKey = keys.gemini || process.env.GEMINI_API_KEY;
          if (!apiKey) { lastErrors.push("Gemini: no key"); continue; }
          const uniqueModels = Array.from(new Set(VALID_GEMINI_MODELS.filter(Boolean)));
          addLog(`📡 Gemini models fallback: ${uniqueModels.join(" → ")}`);
          try {
            const genAI = new GoogleGenerativeAI(apiKey);
            for (const modelName of uniqueModels) {
              try {
                const model = genAI.getGenerativeModel({
                  model: modelName as string,
                  safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                  ]
                });
                const result = await model.generateContent(prompt);
                const text = result.response.text();
                if (text) {
                  addLog(`✅ Gemini OK (${modelName})`);
                  return text;
                }
              } catch (modelErr: any) {
                const modelMsg = modelErr?.message || String(modelErr);
                if (modelMsg.includes("404") || modelMsg.includes("not found")) {
                  addLog(`⚠️ Gemini model unavailable: ${modelName}`);
                  continue;
                }
                throw modelErr;
              }
            }
            throw new Error("No available Gemini model from fallback list");
          } catch (e: any) {
            let errMsg = e.message || String(e);
            if (errMsg.includes('GoogleGenerativeAI Error')) {
              try {
                const match = errMsg.match(/\[(\{.*\})\]/);
                if (match) {
                  const parsed = JSON.parse(match[1]);
                  errMsg = parsed.error?.message || parsed.message || parsed.reason || errMsg;
                }
              } catch {}
            }
            const isQuota = errMsg.includes("429")
              || errMsg.includes("quota")
              || errMsg.includes("RESOURCE_EXHAUSTED")
              || errMsg.includes("Too Many Requests");
            if (isQuota) {
              const retrySeconds = extractRetryDelaySeconds(errMsg);
              const retryHint = retrySeconds ? ` Retry in ~${retrySeconds}s.` : "";
              addLog(`⚠️ Gemini quota hit.${retryHint}`);
              lastErrors.push(`Gemini quota exceeded.${retryHint}`);
              disabledProviders.add("gemini");
              continue;
            }
            addLog(`❌ Gemini: ${errMsg}`);
            lastErrors.push(`Gemini: ${errMsg}`);
          }
        }

        // ---- OpenRouter ----
        else if (cur === "openrouter") {
          const apiKey = keys.openrouter || process.env.OPENROUTER_API_KEY;
          if (!apiKey) { lastErrors.push("OpenRouter: no key"); continue; }
          addLog("📡 OpenRouter (gpt-4o-mini)...");
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const r = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }] },
                { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 60000 }
              );
              if (r.data.choices?.[0]?.message?.content) {
                addLog("✅ OpenRouter OK");
                return r.data.choices[0].message.content;
              }
              break;
            } catch (e: any) {
              const status = e.response?.status;
              if ((status === 429 || status === 503) && attempt < 3) {
                addLog(`⚠️ OpenRouter ${status}, retry ${attempt}/3...`);
                await sleep(5000 * attempt);
              } else { throw e; }
            }
          }
        }

        // ---- DeepSeek ----
        else if (cur === "deepseek") {
          const apiKey = keys.deepseek || process.env.DEEPSEEK_API_KEY;
          if (!apiKey) { lastErrors.push("DeepSeek: no key"); continue; }
          const modelName = "deepseek-chat";
          addLog(`📡 DeepSeek (${modelName})...`);
          try {
            const r = await axios.post(
              "https://api.deepseek.com/chat/completions",
              {
                model: modelName,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
                max_tokens: 4000,
                stream: false
              },
              {
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json"
                },
                timeout: 60000
              }
            );
            const responseText = r.data.choices?.[0]?.message?.content;
            if (responseText) {
              addLog("✅ DeepSeek OK");
              return responseText;
            }
          } catch (e: any) {
            const msg = e.response?.data?.error?.message || e.message;
            addLog(`❌ DeepSeek: ${msg}`);
            lastErrors.push(`DeepSeek: ${msg}`);
          }
        }

      } catch (e: any) {
        let errMsg = e.response?.data?.error?.message || e.message;
        try {
          if (typeof errMsg === 'string' && errMsg.startsWith('{')) {
            const parsed = JSON.parse(errMsg);
            errMsg = parsed.error?.message || errMsg;
          }
        } catch {}
        addLog(`❌ ${cur}: ${errMsg}. Следующий...`);
        lastErrors.push(`${cur}: ${errMsg}`);
      }
    }
    await sleep(1000);
  }

  addLog("❌ Все AI провайдеры не сработали.");
  return `⚠️ Ошибка перевода.\n\nПричины:\n${lastErrors.join("\n")}\n\nОригинальный текст:\n${text.substring(0, 2000)}`;
}

// ---- Text handler ----
async function handleTextProcessing(text: string, senderChatId: string | number, telegram: any) {
  try {
    const aiText = await processWithAI(text);
    const opts   = { parse_mode: "HTML" as const };
    const target = DEFAULT_CHAT_ID || senderChatId;

    if (aiText.length <= 4090) {
      await telegram.sendMessage(target, aiText, opts);
    } else {
      let buf = "";
      for (const para of aiText.split("\n\n")) {
        if ((buf + para).length > 4000) {
          await telegram.sendMessage(target, buf, opts);
          buf = para + "\n\n";
        } else { buf += para + "\n\n"; }
      }
      if (buf.trim()) await telegram.sendMessage(target, buf, opts);
    }
    addLog(`✅ Text sent to ${target}`);
  } catch (e: any) {
    addLog(`handleTextProcessing error: ${e.message}`);
    try { await telegram.sendMessage(senderChatId, `❌ Ошибка: ${e.message}`); } catch {}
  }
}

// ---- Bot lifecycle ----
async function stopBot(reason = "Stopping") {
  if (botRetryTimeout) { clearTimeout(botRetryTimeout); botRetryTimeout = null; }
  if (botHealthInterval) { clearInterval(botHealthInterval); botHealthInterval = null; }
  botHealthFails = 0;
  if (bot) {
    try {
      addLog(`🛑 Stopping bot: ${reason}`);
      try { await bot.stop(reason); } catch {}
      await sleep(500);
    } catch (e: any) { addLog(`⚠️ Stop error: ${e.message}`); }
    bot = null;
  }
}

async function initBot(token: string) {
  if (!token || !token.trim()) {
    addLog("⚠️ initBot: no token");
    botError = null;
    return;
  }

  if (isInitializingBot) {
    addLog("⚠️ Bot init already in progress");
    return;
  }

  isInitializingBot = true;
  botError = null;
  if (botHealthInterval) { clearInterval(botHealthInterval); botHealthInterval = null; }
  botHealthFails = 0;

  try {
    addLog(`🤖 Bot init (${token.substring(0, 5)}***, mode: polling)`);

    if (bot) {
      addLog("🛑 Stopping old bot instance...");
      try {
        // Принудительно останавливаем polling и очищаем все
        await bot.stop("Restarting");
        // Удаляем все ссылки, чтобы GC мог собрать объект
        (bot as any) = null;
      } catch (e: any) {
        addLog(`⚠️ Error stopping old bot: ${e.message}`);
      }
      // Увеличиваем паузу, чтобы Telegram успел закрыть сессию
      await sleep(5000); 
    }

    // Повторная проверка перед созданием нового экземпляра
    if (bot) {
        addLog("⚠️ Bot instance was recreated during stop, aborting.");
        isInitializingBot = false;
        return;
    }

    const newBot = new Telegraf(token, {
      handlerTimeout: 90_000,
      telegram: {
        apiRoot: "https://api.telegram.org",
      }
    });

    newBot.catch((err: any) => {
      const errMsg = err.message || String(err);
      botError = errMsg;
      addLog(`❌ Bot Error: ${errMsg}`);
      if (errMsg.includes("ETIMEDOUT") || errMsg.includes("ECONNRESET")) {
        addLog("⚠️ Network issue detected. Bot will continue trying...");
      }
    });

    newBot.start((ctx: any) => ctx.reply("✅ Бот запущен!\n\nПришлите текст для публикации."));
    newBot.on("text", (ctx: any) => {
      handleTextProcessing(ctx.message.text, ctx.chat.id, ctx.telegram);
    });

    addLog("📡 Testing connection to Telegram API...");
    const me = await newBot.telegram.getMe().catch(err => {
      throw new Error(`Telegram API unreachable: ${err.message}`);
    });
    
    addLog(`✅ Bot authorized as @${me.username}`);

    addLog("🧹 Deleting webhook before polling...");
    // Принудительно удаляем webhook, используя временный экземпляр Telegraf, 
    // чтобы быть уверенными, что Telegram не шлет обновления по старому каналу
    const tempBot = new Telegraf(token);
    await tempBot.telegram.deleteWebhook({ drop_pending_updates: true }).catch((e: any) => {
      addLog(`⚠️ deleteWebhook warning: ${e.message}`);
    });

    addLog("🚀 Launching polling...");
    const launchPromise = newBot.launch({ dropPendingUpdates: true });
    
    // Handle errors that happen during polling
    launchPromise.catch((e: any) => {
      const errMsg = e?.message || String(e);
      addLog(`❌ Bot polling fatal error: ${errMsg}`);
      bot = null;
      botError = errMsg;
    });
    
    // Wait up to 3s for immediate startup errors (like 409 Conflict)
    // If it doesn't fail within 3s, we assume it's running fine.
    await Promise.race([
      launchPromise,
      new Promise((_, reject) => setTimeout(() => reject("TIMEOUT"), 3000))
    ]).catch(err => {
      if (err !== "TIMEOUT") throw err;
    });

    bot = newBot;
    bot409Retries = 0;
    startBotHealthMonitor(token, newBot);
    addLog("✅ Polling mode active");
  } catch (e: any) {
    bot = null;
    if (botHealthInterval) { clearInterval(botHealthInterval); botHealthInterval = null; }
    const errMsg = e?.message || String(e);
    botError = errMsg;
    addLog(`❌ Bot init failed: ${botError}`);
    addLog("🛑 Bot stopped due to error. Manual restart required.");
  } finally {
    isInitializingBot = false;
  }
}

process.once("SIGINT",  async () => { await stopBot("SIGINT");  process.exit(0); });
process.once("SIGTERM", async () => { await stopBot("SIGTERM"); process.exit(0); });
process.on("unhandledRejection", (reason) => { console.error("UnhandledRejection:", reason); });

// ---- Publish ----
async function publishPostToTelegram(post: any) {
  try {
    const activeBot = bot;
    if (!activeBot || !DEFAULT_CHAT_ID) throw new Error("Bot or Chat ID not set");

    const chatId: string | number = isNaN(Number(DEFAULT_CHAT_ID))
      ? DEFAULT_CHAT_ID : Number(DEFAULT_CHAT_ID);
    addLog(`📤 Publishing to ${chatId}...`);

    const extra: any = {};
    if (post.buttons?.length) {
      const btns = post.buttons
        .filter((b: any) => b.text?.trim() && b.url?.trim() && !b.url.match(/^https?:\/\/?$/))
        .map((b: any) => {
          let u = b.url.trim();
          if (!u.startsWith("http")) u = "https://" + u;
          return [{ text: b.text, url: u }];
        });
      if (btns.length) extra.reply_markup = { inline_keyboard: btns };
    }

    const applyReactions = async (msgId: number) => {
      if (!post.reactions?.length) return;
      const rx = post.reactions.slice(0, 3).map((r: any) => ({ type: "emoji", emoji: r.emoji }));
      try { await activeBot.telegram.setMessageReaction(chatId, msgId, rx); }
      catch { try { await activeBot.telegram.setMessageReaction(chatId, msgId, [rx[0]]); } catch {} }
    };

    const media = (s: string) => {
      if (s.startsWith("data:image")) {
        return { source: Buffer.from(s.split(",")[1], "base64") };
      }
      if (s.startsWith("/api/images/file/")) {
        const filename = decodeURIComponent(s.split("/").pop() || "");
        const imgPath = getPersistentImagePath();
        if (imgPath && filename) {
          const fullPath = path.join(imgPath, filename);
          if (fs.existsSync(fullPath)) {
            return { source: fullPath };
          }
        }
        throw new Error(`Изображение не найдено на сервере: ${filename}`);
      }
      return s;
    };

    const rawText = post.text || "";
    // Pre-process markdown: replace leading spaces with non-breaking spaces to preserve indents
    // and prevent 4 spaces from turning into code blocks.
    const preprocessedMd = rawText.replace(/^[ \t]+/gm, (match: string) => '&nbsp;'.repeat(match.length));
    
    // Also support Telegram spoilers parsing
    const spoilerPreprocessed = preprocessedMd.replace(/\|\|([\s\S]+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
    
    const htmlText = marked.parse(spoilerPreprocessed) as string;
    const cleanText = sanitizeHtml(htmlText);
    
    if (!cleanText && !post.mainImage && !post.selectedImages?.length) {
      throw new Error("Message text is empty and no images provided");
    }

    const balanceHtml = (html: string) => {
      try {
        // Use load(html, null, false) to prevent adding <html>, <head>, <body> tags
        const $ = load(html, { xmlMode: false }, false);
        return $.html();
      } catch {
        return html;
      }
    };

    const cap = (t: string) => t.length > 1024 ? balanceHtml(t.slice(0, 1020) + "…") : balanceHtml(t);

    const sendImages = async (images: string[]) => {
      for (let i = 0; i < images.length; i += 10) {
        const chunk = images.slice(i, i + 10);
        if (chunk.length > 1)
          await activeBot.telegram.sendMediaGroup(chatId,
            chunk.map((img: string) => ({ type: "photo", media: media(img) })) as any
          );
        else
          await activeBot.telegram.sendPhoto(chatId, media(chunk[0]));
        await sleep(2000);
      }
    };

    const mainImage = post.mainImage || post.selectedImages?.[0];
    const allImages = post.selectedImages || [];

    if (mainImage) {
      if (extra.reply_markup || allImages.length <= 1) {
        const msg = await activeBot.telegram.sendPhoto(chatId, media(mainImage), {
          caption: cap(cleanText), parse_mode: "HTML", ...extra,
        });
        await applyReactions(msg.message_id);
        await sendImages(allImages.filter((img: string) => img !== mainImage));
      } else {
        const mediaGroup = allImages.map((img: string, idx: number) => ({
          type: "photo" as const, media: media(img),
          ...(idx === 0 ? { caption: cap(cleanText), parse_mode: "HTML" as const } : {}),
        }));
        for (let i = 0; i < mediaGroup.length; i += 10) {
          const msgs = await activeBot.telegram.sendMediaGroup(chatId, mediaGroup.slice(i, i + 10));
          if (i === 0 && msgs.length > 0) await applyReactions(msgs[0].message_id);
          await sleep(2000);
        }
      }
    } else {
      const msgText = cleanText.length > 4096 ? balanceHtml(cleanText.slice(0, 4090) + "…") : balanceHtml(cleanText);
      const msg = await activeBot.telegram.sendMessage(chatId, msgText,
        { parse_mode: "HTML", ...extra }
      );
      await applyReactions(msg.message_id);
    }

    addLog("✅ Published");

    // Сохраняем в список опубликованных (макс 5)
    const published = getPersistentPublishedPosts();
    const postToSave = { ...post, publishedAt: Date.now() };
    if (!postToSave.id) postToSave.id = uuidv4();
    const newPublished = [postToSave, ...published].slice(0, 5);
    await savePersistentPublishedPosts(newPublished);

  } catch (e: any) {
    addLog(`❌ Publish Error: ${e.message}`);
    throw e;
  }
}

// ---- API Routes ----

app.get("/api/ping", (_req: any, res: any) => res.json({ pong: true }));

app.post("/api/upload-images", async (req: Request, res: Response) => {
  if (!req.body) return res.status(400).json({ error: "Request body required" });
  try {
    const { images, path: targetPath } = req.body;
    if (!Array.isArray(images)) return res.status(400).json({ error: "Images array required" });

    const destDir = path.resolve(targetPath || getPersistentImagePath() || DATA_DIR);

    // Validate destination is not a sensitive system path
    const blockedPaths = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows', 'C:\\Program Files'];
    if (blockedPaths.some(bp => destDir.toLowerCase().startsWith(bp.toLowerCase()))) {
      return res.status(403).json({ error: "Upload to this path is restricted" });
    }

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    let count = 0;
    for (const img of images) {
      if (!img.base64 || !img.name) continue;
      // Sanitize filename to prevent path traversal
      const safeName = path.basename(img.name);
      if (!safeName || safeName.startsWith('.')) continue;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const filePath = path.join(destDir, safeName);
      // Double-check resolved path stays within destDir
      if (!path.resolve(filePath).startsWith(destDir)) continue;
      fs.writeFileSync(filePath, buffer);
      count++;
    }
    addLog(`📤 Uploaded ${count} images to ${destDir}`);
    res.json({ success: true, count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async (req: Request, res: Response) => {
  const token = getPersistentToken();
  res.json({
    status: "online",
    bot: bot ? "active" : (isInitializingBot ? "starting" : "offline"),
    botError,
    hasDefaultChat: !!DEFAULT_CHAT_ID,
    defaultChatId:  DEFAULT_CHAT_ID,
    lastChatId:     DEFAULT_CHAT_ID || null,
    hasToken:       !!token,
    botTokenMasked: token ? `${token.substring(0, 5)}***` : null,
    serverUrl:      req.headers.host,
    webhookMode:    false,
  });
});

app.post("/api/config/token", mutationRateLimiter, async (req: Request, res: Response) => {
  if (!req.body) return res.status(400).json({ error: "Request body required" });
  const { token } = req.body;
  try {
    await savePersistentToken(token || "");
    if (token) await initBot(token);
    else await stopBot("Token cleared");
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/config/clear-token", mutationRateLimiter, async (req: Request, res: Response) => {
  try {
    await stopBot("Token cleared");
    await savePersistentToken("");
    botError = null;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/config/chat-id", mutationRateLimiter, async (req: Request, res: Response) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  const idStr = String(chatId).trim();
  if (!/^-?\d+$|^@[a-zA-Z0-9_]+$/.test(idStr))
    return res.status(400).json({ error: "Invalid chat ID format" });
  DEFAULT_CHAT_ID = idStr;
  await savePersistentChatId(idStr);
  addLog(`✅ Chat ID updated: ${idStr}`);
  res.json({ success: true, chatId: idStr });
});

app.get("/api/config/chat-id", (_req: any, res: any) =>
  res.json({ chatId: DEFAULT_CHAT_ID })
);

app.get("/api/config/chat-id-presets", (_req: any, res: any) =>
  res.json(getPersistentChatIdPresets())
);
app.post("/api/config/chat-id-presets", mutationRateLimiter, async (req: Request, res: Response) => {
  const { presets } = req.body;
  if (!Array.isArray(presets) || presets.length !== 3)
    return res.status(400).json({ error: "Invalid presets" });
  await savePersistentChatIdPresets(presets);
  res.json({ success: true });
});

app.post("/api/config/api-key", mutationRateLimiter, async (req: Request, res: Response) => {
  const { apiKey, provider, preferredProvider } = req.body;
  if (preferredProvider) {
    await savePersistentApiKeys({ preferredProvider });
    return res.json({ success: true });
  }
  if (!apiKey || !provider) return res.status(400).json({ error: "apiKey and provider required" });
  await savePersistentApiKeys({ [provider]: apiKey });
  addLog(`💾 API key saved: ${provider}`);
  res.json({ success: true });
});

const apiKeyStatus = (_req: any, res: any) => {
  const k = getPersistentApiKeys();
  const m: Record<string, boolean> = {};
  for (const [p, v] of Object.entries(k)) {
    if (p !== 'preferredProvider') m[p] = !!v;
  }
  res.json({
    hasServerKey: !!process.env.GEMINI_API_KEY,
    serverKeyMasked: process.env.GEMINI_API_KEY ? "********" : null,
    apiKeys: m,
    preferredProvider: k.preferredProvider || 'gemini'
  });
};
app.get("/api/config/server-key", apiKeyStatus);
app.get("/api/config/status",     apiKeyStatus);

app.post("/api/bot/test-message", mutationRateLimiter, async (req: Request, res: Response) => {
  if (!bot || !DEFAULT_CHAT_ID) return res.status(400).json({ error: "Bot or Chat ID not set" });
  try {
    await bot.telegram.sendMessage(DEFAULT_CHAT_ID, "🔔 Тестовое сообщение!");
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/bot/stop", mutationRateLimiter, async (req: Request, res: Response) => {
  try { await stopBot("Manual stop"); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/bot/restart", mutationRateLimiter, async (req: Request, res: Response) => {
  const token = await getPersistentToken();
  if (!token) return res.status(400).json({ error: "No token saved" });
  await stopBot("Restart");
  try { await initBot(token); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/config/image-path", mutationRateLimiter, async (req: Request, res: Response) => {
  const { path: imagePath } = req.body;
  if (imagePath === undefined) return res.status(400).json({ error: "Path required" });
  await savePersistentImagePath(imagePath);
  res.json({ success: true });
});

app.get("/api/config/image-path", (_req: any, res: any) =>
  res.json({ path: getPersistentImagePath() })
);

app.get("/api/images/sync", async (req: Request, res: Response) => {
  const imgPath = getPersistentImagePath();
  if (!imgPath || !fs.existsSync(imgPath)) return res.json({ images: [] });
  
  try {
    const files = (await fs.promises.readdir(imgPath)).slice(0, 500);
    const images: { url: string; mtime: number }[] = [];
    const MAX_SIZE = 15 * 1024 * 1024; 

    for (const f of files) {
      if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(f)) continue;
      const fullPath = path.join(imgPath, f);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.size > MAX_SIZE) continue;
        
        images.push({
          url: `/api/images/file/${encodeURIComponent(f)}`,
          mtime: stats.mtimeMs
        });
      } catch (e) {}
    }
    images.sort((a, b) => b.mtime - a.mtime);
    res.json({ images: images.map(i => i.url).slice(0, 20) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/images/file/:filename", (req: Request, res: Response) => {
  const imgPath = getPersistentImagePath();
  if (!imgPath || !fs.existsSync(imgPath)) {
    return res.status(404).send("Image folder not configured");
  }
  
  const normalizedImgPath = path.resolve(imgPath);
  const filePath = path.resolve(normalizedImgPath, req.params.filename);
  
  // Защита от path traversal
  if (!filePath.startsWith(normalizedImgPath)) {
    return res.status(403).send("Forbidden");
  }
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Image not found");
  }
  
  res.sendFile(filePath);
});

app.get("/api/logs", (_req: Request, res: Response) => {
  res.json({ logs: logManager.getLogs() });
});

app.post("/api/process-text", aiRateLimiter, mutationRateLimiter, async (req: Request, res: Response) => {
  const { text, provider } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  try { res.json({ processedText: await processWithAI(text, provider) }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Drafts
app.get("/api/posts/drafts", (_req: any, res: any) =>
  res.json(getPersistentPosts().filter(p => p.status === "draft"))
);
app.post("/api/process-url", aiRateLimiter, mutationRateLimiter, async (req: Request, res: Response) => {
  const { url, provider } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });
  try {
    addLog(`🌐 Processing URL: ${url}`);
    const response = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = load(response.data);
    
    // Remove scripts and styles
    $('script, style, nav, footer').remove();
    
    const title = $('title').text() || $('h1').first().text() || "No title";
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 10000);
    
    const fullText = `${title}\n\n${bodyText}`;
    const processed = await processWithAI(fullText, provider);
    
    res.json({ processedText: processed, originalTitle: title });
  } catch (e: any) {
    addLog(`❌ URL Process Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/posts/drafts", mutationRateLimiter, async (req: Request, res: Response) => {
  const post = req.body;
  if (!post.id) post.id = uuidv4();
  post.status = "draft"; post.updatedAt = Date.now();
  if (!post.createdAt) post.createdAt = Date.now();
  const posts = getPersistentPosts();
  const idx   = posts.findIndex(p => p.id === post.id);
  if (idx >= 0) posts[idx] = post; else posts.push(post);
  await savePersistentPosts(posts);
  res.json(post);
});
app.delete("/api/posts/drafts/:id", mutationRateLimiter, async (req: Request, res: Response) => {
  const posts = getPersistentPosts();
  const next  = posts.filter(p => String(p.id) !== String(req.params.id));
  if (next.length === posts.length) return res.status(404).json({ error: "Draft not found" });
  await savePersistentPosts(next);
  res.json({ success: true });
});

// Scheduled
app.get("/api/posts/scheduled", (_req: any, res: any) =>
  res.json(getPersistentPosts().filter(p => p.status === "scheduled"))
);

app.get("/api/posts/published", (_req: any, res: any) =>
  res.json(getPersistentPublishedPosts())
);
app.delete("/api/posts/published/:id", mutationRateLimiter, async (req: Request, res: Response) => {
  const published = getPersistentPublishedPosts();
  const next = published.filter((p: any) => String(p.id) !== String(req.params.id));
  await savePersistentPublishedPosts(next);
  res.json({ success: true });
});
app.post("/api/posts/schedule", mutationRateLimiter, async (req: Request, res: Response) => {
  const upd   = req.body;
  const posts = getPersistentPosts();
  const idx   = posts.findIndex(p => p.id === upd.id);
  if (idx >= 0) posts[idx] = { ...posts[idx], ...upd, status: "scheduled", updatedAt: Date.now() };
  else {
    upd.status = "scheduled"; upd.updatedAt = Date.now();
    if (!upd.createdAt) upd.createdAt = Date.now();
    if (!upd.id) upd.id = uuidv4();
    posts.push(upd);
  }
  await savePersistentPosts(posts);
  res.json(posts[idx] || upd);
});

app.post("/api/posts/publish", mutationRateLimiter, async (req: Request, res: Response) => {
  if (!DEFAULT_CHAT_ID) return res.status(400).json({ error: "Chat ID not set" });
  try {
    const post = req.body;
    if (!post || !post.text) return res.status(400).json({ error: "Invalid post data" });
    await publishPostToTelegram(post);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Templates — Buttons
app.get("/api/posts/templates/buttons", (_req: any, res: any) =>
  res.json(getPersistentTemplates().buttons)
);
app.post("/api/posts/templates/buttons", mutationRateLimiter, async (req: Request, res: Response) => {
  const t    = req.body;
  const tmpl = getPersistentTemplates();
  if (!t.id) {
    const ex = tmpl.buttons.find((x: any) => x.name === t.name);
    t.id = ex ? ex.id : uuidv4();
  }
  const i = tmpl.buttons.findIndex((x: any) => x.id === t.id);
  if (i >= 0) tmpl.buttons[i] = t; else tmpl.buttons.push(t);
  await savePersistentTemplates(tmpl);
  addLog(`💾 Button template: ${t.name}`);
  res.json(t);
});
app.delete("/api/posts/templates/buttons/:id", mutationRateLimiter, async (req: Request, res: Response) => {
  const tmpl = getPersistentTemplates();
  const was  = tmpl.buttons.length;
  tmpl.buttons = tmpl.buttons.filter((t: any) => t.id !== req.params.id && t.name !== req.params.id);
  await savePersistentTemplates(tmpl);
  res.json({ success: true, deletedCount: was - tmpl.buttons.length });
});

// Templates — Reactions
app.get("/api/posts/templates/reactions", (_req: any, res: any) =>
  res.json(getPersistentTemplates().reactions || [])
);
app.post("/api/posts/templates/reactions", mutationRateLimiter, async (req: Request, res: Response) => {
  const t    = req.body; if (!t.id) t.id = uuidv4();
  const tmpl = getPersistentTemplates();
  if (!tmpl.reactions) tmpl.reactions = [];
  const i = tmpl.reactions.findIndex((x: any) => x.id === t.id);
  if (i >= 0) tmpl.reactions[i] = t; else tmpl.reactions.push(t);
  await savePersistentTemplates(tmpl);
  res.json(t);
});
app.delete("/api/posts/templates/reactions/:id", mutationRateLimiter, async (req: Request, res: Response) => {
  const tmpl = getPersistentTemplates();
  tmpl.reactions = (tmpl.reactions || []).filter((t: any) => t.id !== req.params.id);
  await savePersistentTemplates(tmpl);
  res.json({ success: true });
});

// Test
app.post("/api/test-key", aiRateLimiter, async (req: Request, res: Response) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const uniqueModels = Array.from(new Set(VALID_GEMINI_MODELS.filter(Boolean)));

    for (const modelName of uniqueModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName as string,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
        });
        const r = await Promise.race([
          model.generateContent("Hello"),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout")), 30000)),
        ]) as any;
        const text = r.response.text();
        if (text) return res.json({ success: true, model: modelName });
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
          const retrySeconds = extractRetryDelaySeconds(msg);
          const retryHint = retrySeconds ? ` Retry in ~${retrySeconds}s.` : "";
          return res.status(429).json({ error: `Gemini quota exceeded.${retryHint}` });
        }
        if (msg.includes("404") || msg.includes("not found")) continue;
      }
    }

    res.status(400).json({ error: "No available Gemini model for this API key" });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.post("/api/test-ai", aiRateLimiter, async (req: Request, res: Response) => {
  if (!req.body) return res.status(400).json({ error: "Request body required" });
  const { provider, apiKey, text } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: "provider and apiKey required" });
  try {
    const result = await processWithAI(
      text || "Переведи на русский: Hello World",
      provider, { [provider]: apiKey }
    );
    res.json({ success: true, result });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/utils/list-dirs", async (req: Request, res: Response) => {
  const { path: dirPath } = req.query;
  const targetPath = path.resolve(dirPath ? String(dirPath) : process.cwd());

  // Block access to sensitive system directories
  const blockedPaths = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows', 'C:\\Program Files'];
  if (blockedPaths.some(bp => targetPath.toLowerCase().startsWith(bp.toLowerCase()))) {
    return res.status(403).json({ error: "Access to this path is restricted" });
  }

  try {
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: "Path not found" });
    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: "Not a directory" });

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(targetPath, e.name) }));
    
    res.json({ 
      currentPath: targetPath, 
      parentPath: path.dirname(targetPath),
      dirs 
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/test-telegram", async (req: Request, res: Response) => {
  if (!req.body) return res.status(400).json({ error: "Request body required" });
  const { token, chatId } = req.body;
  if (!token || !chatId) return res.status(400).json({ error: "token and chatId required" });
  try {
    await new Telegraf(token).telegram.sendMessage(chatId, "✅ Тест успешен!");
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ---- Server Start ----
async function startServer() {
  try {
    await loadAllData();
    DEFAULT_CHAT_ID = getPersistentChatId();
    addLog(`🆔 Chat ID: ${DEFAULT_CHAT_ID || "None"}`);

    const savedToken = getPersistentToken();
    if (savedToken) {
      addLog("🔑 Found saved token, starting bot...");
      try {
        await initBot(savedToken);
      } catch (e: any) {
        addLog(`⚠️ Bot start failed: ${e.message}. Set token via UI to retry.`);
      }
    } else {
      addLog("⚠️ No token loaded. Please set token via UI to start the bot.");
      addLog("💡 Tip: Create a NEW token in @BotFather to avoid conflicts");
    }

    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      addLog("🚀 Vite middleware enabled (Development)");
    } else {
      const dist = path.join(process.cwd(), "dist");
      if (fs.existsSync(dist)) {
        app.use(express.static(dist));
        app.get("*", (_req: any, res: any) => res.sendFile(path.join(dist, "index.html")));
        addLog("📦 Serving static files from dist (Production)");
      } else {
        addLog("⚠️ dist folder not found! Static files will not be served.");
      }
    }

    const PORT = Number(process.env.PORT) || 3000;
    app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server on port ${PORT}`));

    // Планировщик публикаций (запускается каждую минуту)
    setInterval(async () => {
      const now = Date.now();
      const posts = getPersistentPosts();
      let changed = false;
      
      for (const post of posts) {
        if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= now) {
          try {
            addLog(`📅 Публикация запланированного поста: ${post.id}`);
            await publishPostToTelegram(post);
            
            // Обновляем статус на 'published'
            post.status = 'published';
            post.publishedAt = now;
            changed = true;
            
            addLog(`✅ Запланированный пост опубликован: ${post.id}`);
            // Добавляем задержку 2 секунды между публикациями
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (e: any) {
            logError(`❌ Ошибка публикации поста ${post.id}: ${e.message}`);
          }
        }
      }
      if (changed) await savePersistentPosts(posts);
    }, 60000);

  } catch (err) {
    console.error("FATAL: Server start failed", err);
    process.exit(1);
  }
}

startServer();