import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { Telegraf } from "telegraf";
import axios from "axios";
import * as dotenv from "dotenv";
import { serverStorage } from './serverStorage';
import { FileLogger, sanitizeHtml } from './src/serverUtils';
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { load } from "cheerio";
import { marked } from 'marked';
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
  grok?: string; openrouter?: string; openrouter2?: string;
  deepseek?: string; preferredProvider?: string;
}

async function loadAllData() {
  cachedApiKeys       = await serverStorage.readJsonFile<ApiKeys>(API_KEYS_FILE, {});
  cachedPosts         = await serverStorage.readJsonFile<any[]>(POSTS_FILE, []);
  cachedPublishedPosts = (await serverStorage.readJsonFile<any[]>(PUBLISHED_POSTS_FILE, [])).map(p => {
    if (!p.id) p.id = uuidv4();
    return p;
  });
  cachedTemplates     = await serverStorage.readJsonFile(TEMPLATES_FILE, { buttons: [], reactions: [] });
  cachedImagePath     = await serverStorage.readTextFile(IMAGE_PATH_FILE, "");
  cachedChatIdPresets = await serverStorage.readJsonFile<string[]>(CHAT_ID_PRESETS_FILE, ["", "", ""]);
  if (!cachedTemplates.buttons)   cachedTemplates.buttons   = [];
  if (!cachedTemplates.reactions) cachedTemplates.reactions = [];
  
  // Force save templates to ensure file exists
  await serverStorage.writeJsonFile(TEMPLATES_FILE, cachedTemplates);
}

function getPersistentApiKeys(): ApiKeys { return cachedApiKeys; }
async function savePersistentApiKeys(k: ApiKeys) {
  Object.assign(cachedApiKeys, k);
  await serverStorage.writeJsonFile(API_KEYS_FILE, cachedApiKeys);
}
function getPersistentPosts(): any[] { return cachedPosts; }
async function savePersistentPosts(p: any[]) {
  cachedPosts = p;
  await serverStorage.writeJsonFile(POSTS_FILE, cachedPosts);
}
function getPersistentPublishedPosts(): any[] { return cachedPublishedPosts; }
async function savePersistentPublishedPosts(p: any[]) {
  cachedPublishedPosts = p;
  await serverStorage.writeJsonFile(PUBLISHED_POSTS_FILE, cachedPublishedPosts);
}
function getPersistentTemplates(): any { return cachedTemplates; }
async function savePersistentTemplates(t: any) {
  cachedTemplates = t;
  await serverStorage.writeJsonFile(TEMPLATES_FILE, cachedTemplates);
}
function getPersistentImagePath(): string { return cachedImagePath; }
async function savePersistentImagePath(p: string) {
  cachedImagePath = p;
  await serverStorage.writeTextFile(IMAGE_PATH_FILE, p);
}
function getPersistentChatIdPresets(): string[] { return cachedChatIdPresets; }
async function savePersistentChatIdPresets(p: string[]) {
  cachedChatIdPresets = p;
  await serverStorage.writeJsonFile(CHAT_ID_PRESETS_FILE, cachedChatIdPresets);
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
  await serverStorage.writeTextFile(TOKEN_FILE, token);
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
  await serverStorage.writeTextFile(CHAT_ID_FILE, id);
  console.log(`✅ Saved Chat ID: ${id}`);
}

// ---- Globals ----
let bot: Telegraf | null     = null;
let botError: string | null  = null;
let DEFAULT_CHAT_ID: string | number = "";
let isInitializingBot        = false;
let botRetryTimeout: NodeJS.Timeout | null = null;
let botHealthInterval: NodeJS.Timeout | null = null;
let botHealthFails = 0;
const BOT_MAX_HEALTH_FAILS = 3;
const BOT_HEALTHCHECK_MS = 60_000;
let bot409Retries = 0;

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
  const providers = ["github", "deepseek", "openrouter", "openrouter2"];
  const saved     = getPersistentApiKeys();
  const effective = provider || saved.preferredProvider || "github";
  const ordered   = [effective, ...providers.filter(p => p !== effective)];
  const keys      = { ...saved, ...customApiKeys };
  const disabledProviders = new Set<string>();

  const containsChinese = (str: string) => /[\u4E00-\u9FFF]/.test(str);

  const prompt = `Ты — опытный редактор новостей. Твоя задача — перевести текст на русский язык.

ИНСТРУКЦИИ:
1. ПЕРЕВОД: Переведи всё на русский. Бренды и модели авто можно оставить на латинице, если так лучше для понимания.
2. ЗАПРЕТ: Никаких китайских иероглифов. Если слово нельзя перевести, используй английский эквивалент.
3. ОФОРМЛЕНИЕ:
   - Заголовок в начале. Разделяй текст на логические абзацы.
   - Используй ТОЛЬКО разрешенные Telegram HTML теги: <b>жирный</b>, <i>курсив</i>, <u>подчеркнутый</u>, <s>зачеркнутый</s>, <a>ссылка</a>, <code>код</code>.
   - СТРОГО ЗАПРЕЩЕНО использовать теги <h1>, <h2>, <h3>, <p>, <br> и любые другие HTML-теги, не указанные выше. Заголовки выделяй просто жирным шрифтом <b>Заголовок</b>.
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩАЕТСЯ использовать разделительные горизонтальные линии (тег h r). Никогда не добавляй их в ответ.
4. ХЭШТЕГИ: Добавь тематические теги в конце.

Текст для перевода:
${text.substring(0, 20000)}`;

  const lastErrors: string[] = [];
  const timeout = 120000; // 120 seconds timeout

  for (let cycle = 1; cycle <= 3; cycle++) {
    if (cycle > 1) addLog(`🔄 AI retry ${cycle}/3...`);

    for (const cur of ordered) {
      if (disabledProviders.has(cur)) continue;
      
      try {
        let aiResult = "";
        
        // ---- GitHub ----
        if (cur === "github") {
          const apiKey = keys.github || process.env.GITHUB_TOKEN;
          if (!apiKey) { lastErrors.push("GitHub: no key"); continue; }
          const modelName = "gpt-4o";
          addLog(`📡 GitHub Models (${modelName})...`);
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const r = await axios.post(
                "https://models.inference.ai.azure.com/chat/completions",
                {
                  model: modelName,
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.1
                },
                {
                  headers: { "Authorization": `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
                  timeout: timeout
                }
              );
              aiResult = r.data.choices?.[0]?.message?.content || "";
              if (aiResult) break;
            } catch (e: any) {
              if (e.response?.status === 429 && attempt < 3) {
                addLog(`⚠️ GitHub Rate limit (attempt ${attempt}), retrying...`);
                await sleep(5000 * attempt);
              } else throw e;
            }
          }
        }
        // ---- OpenRouter ----
        else if (cur === "openrouter") {
          const apiKey = keys.openrouter || process.env.OPENROUTER_API_KEY;
          if (!apiKey) { lastErrors.push("OpenRouter: no key"); continue; }
          const modelId = "nvidia/nemotron-3-super-120b-a12b:free";
          
          addLog(`📡 OpenRouter 1 (Reasoning) trying: ${modelId}...`);
          try {
            // First call
            addLog(`📡 OpenRouter 1: First API call...`);
            const requestBody1: any = { 
              model: modelId, 
              messages: [{ role: "user", content: prompt }],
              reasoning: { enabled: true }
            };

            const r1 = await axios.post(
              "https://openrouter.ai/api/v1/chat/completions",
              requestBody1,
              { 
                headers: { 
                  "Authorization": `Bearer ${apiKey.trim()}`,
                  "HTTP-Referer": process.env.PUBLIC_DOMAIN || "https://newsbot.manager",
                  "X-Title": "TG Bot Manager"
                }, 
                timeout: timeout 
              }
            );
            
            const assistantMessage = r1.data.choices?.[0]?.message;
            if (!assistantMessage) throw new Error("No message returned in Call 1");

            // Second call
            addLog(`📡 OpenRouter 1: Second API call (verifying)...`);
            const requestBody2: any = {
              model: modelId,
              messages: [
                { role: 'user', content: prompt },
                { 
                  role: 'assistant', 
                  content: assistantMessage.content,
                  reasoning_details: assistantMessage.reasoning_details
                },
                { role: 'user', content: "Are you sure? Think carefully." }
              ]
            };

            const r2 = await axios.post(
              "https://openrouter.ai/api/v1/chat/completions",
              requestBody2,
              { 
                headers: { 
                  "Authorization": `Bearer ${apiKey.trim()}`,
                  "HTTP-Referer": process.env.PUBLIC_DOMAIN || "https://newsbot.manager",
                  "X-Title": "TG Bot Manager"
                }, 
                timeout: timeout 
              }
            );

            aiResult = r2.data.choices?.[0]?.message?.content || "";
          } catch (err: any) {
            addLog(`⚠️ OpenRouter 1 Model ${modelId} failed: ${err.message}`);
          }
        }
        // ---- OpenRouter 2 ----
        else if (cur === "openrouter2") {
          const apiKey = keys.openrouter2 || process.env.OPENROUTER_API_KEY_2;
          if (!apiKey) { lastErrors.push("OpenRouter 2: no key"); continue; }
          const models = [
            "openai/gpt-oss-120b:free",
            "nvidia/nemotron-3-super-120b-a12b:free",
            "google/gemini-2.0-flash-001"
          ];
          
          for (const modelId of models) {
            addLog(`📡 OpenRouter 2 trying: ${modelId}...`);
            const requestBody: any = { 
              model: modelId, 
              messages: [{ role: "user", content: prompt }]
            };

            try {
              const r = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                requestBody,
                { 
                  headers: { 
                    "Authorization": `Bearer ${apiKey.trim()}`,
                    "HTTP-Referer": process.env.PUBLIC_DOMAIN || "https://newsbot.manager",
                    "X-Title": "TG Bot Manager"
                  }, 
                  timeout: timeout 
                }
              );
              aiResult = r.data.choices?.[0]?.message?.content || "";
              if (aiResult) break;
            } catch (err: any) {
              addLog(`⚠️ OpenRouter 2 Model ${modelId} failed: ${err.message}`);
            }
          }
        }
        // ---- DeepSeek ----
        else if (cur === "deepseek") {
          const apiKey = keys.deepseek || process.env.DEEPSEEK_API_KEY;
          if (!apiKey) { lastErrors.push("DeepSeek: no key"); continue; }
          addLog("📡 DeepSeek (deepseek-chat)...");
          try {
            const r = await axios.post(
              "https://api.deepseek.com/chat/completions",
              { model: "deepseek-chat", messages: [{ role: "user", content: prompt }], temperature: 0.1 },
              { headers: { Authorization: `Bearer ${apiKey.trim()}` }, timeout: timeout }
            );
            aiResult = r.data.choices?.[0]?.message?.content || "";
          } catch (err: any) { throw err; }
        }

        if (aiResult) {
          addLog(`✅ AI processing succeeded using provider: ${cur}`);
          if (containsChinese(aiResult)) {
            addLog("⚠️ AI output still contains Chinese. Re-verifying...");
          }
          return aiResult;
        }

      } catch (e: any) {
        const msg = e.response?.data?.error?.message || e.message;
        addLog(`❌ AI Provider ${cur} error: ${msg}`);
        lastErrors.push(`${cur}: ${msg}`);
        
        const delayRaw = extractRetryDelaySeconds(msg);
        if (delayRaw) {
          addLog(`⏳ Provider ${cur} requested cooldown of ${delayRaw}s. Waiting...`);
          await sleep(delayRaw * 1000);
        } else if (e.response?.status === 429 || msg.includes('429')) {
          addLog(`⏳ Provider ${cur} rate limited. Cooldown 5s...`);
          await sleep(5000);
        }
      }
    }
  }

  addLog("❌ Все AI провайдеры не сработали.");
  return `⚠️ Ошибка перевода.\n\nЛоги:\n${lastErrors.join("\n")}\n\nОригинал:\n${text.substring(0, 1000)}`;
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
      
      // ✅ Детальная диагностика ошибок
      if (errMsg.includes('409') || errMsg.includes('Conflict')) {
        addLog(`🔴 BOT ERROR 409 CONFLICT: Другой процесс уже получает обновления для этого бота!`);
        addLog(`💡 РЕШЕНИЕ: Остановите другой экземпляр бота (например, standalone на телефоне) или используйте другой токен`);
      } else if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        addLog(`🔴 BOT ERROR 401: Неверный токен бота`);
      } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
        addLog(`⏱️ BOT ERROR: Таймаут при подключении к Telegram API`);
      } else if (errMsg.includes('ECONNRESET') || errMsg.includes('network')) {
        addLog(`🌐 BOT ERROR: Проблемы с сетью`);
      } else {
        addLog(`❌ Bot Error: ${errMsg}`);
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
    
    launchPromise.catch((e: any) => {
      const errMsg = e?.message || String(e);
      
      if (errMsg.includes('409') || errMsg.includes('Conflict')) {
        addLog(`🔴 POLLING ERROR 409: Конфликт с другим процессом!`);
        addLog(`💡 Останавливаем текущего бота...`);
        bot = null;
        botError = "409 Conflict - другой процесс использует этот бот";
      } else {
        addLog(`❌ Bot polling fatal error: ${errMsg}`);
        bot = null;
        botError = errMsg;
      }
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
async function publishPostToTelegram(post: any, host: string = "") {
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
      if (s.includes("/api/images/file/")) {
        const parts = s.split("/api/images/file/");
        const filename = decodeURIComponent(parts[parts.length - 1] || "");
        const imgPath = getPersistentImagePath();
        if (imgPath && filename) {
          const fullPath = path.join(imgPath, filename);
          if (fs.existsSync(fullPath)) {
            return { source: fullPath };
          }
        }
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
    
    if (!cleanText && !post.selectedImages?.length) {
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

    const allImages = (post.selectedImages || []).filter((img: string, i: number, self: string[]) => self.indexOf(img) === i);

    // Order: 1. Text with buttons first
    const msgText = cleanText.length > 4096 ? balanceHtml(cleanText.slice(0, 4090) + "…") : balanceHtml(cleanText);
    const msg = await activeBot.telegram.sendMessage(chatId, msgText, { 
      parse_mode: "HTML", 
      ...extra 
    });
    await applyReactions(msg.message_id);

    // 2. Video (separately, no buttons)
    const video = post.videoPath;
    if (video) {
        await activeBot.telegram.sendVideo(chatId, media(video), { parse_mode: "HTML" });
        await sleep(1000);
    }

    // 3. Images (separately, no buttons)
    if (allImages.length > 0) {
        await sendImages(allImages);
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

    const destDir = targetPath || getPersistentImagePath() || DATA_DIR;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    let count = 0;
    for (const img of images) {
      if (!img.base64 || !img.name) continue;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const filePath = path.join(destDir, img.name);
      fs.writeFileSync(filePath, buffer);
      count++;
    }
    addLog(`📤 Uploaded ${count} images to ${destDir}`);
    res.json({ success: true, count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async (req: Request, res: Response) => {
  const token = await getPersistentToken();
  res.json({
    status: "online",
    bot: bot ? "active" : (isInitializingBot ? "starting" : "offline"),
    botError,
    hasDefaultChat: !!DEFAULT_CHAT_ID,
    defaultChatId:  DEFAULT_CHAT_ID,
    lastChatId:     DEFAULT_CHAT_ID || null,
    hasBotToken:    !!token,
    botTokenPreview: token ? `${token.substring(0, 5)}...` : null,
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

app.post("/api/config/image-path", mutationRateLimiter, (req: Request, res: Response) => {
  const { path: imagePath } = req.body;
  if (imagePath === undefined) return res.status(400).json({ error: "Path required" });
  savePersistentImagePath(imagePath);
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

app.post("/api/posts/drafts", mutationRateLimiter, (req: Request, res: Response) => {
  const post = req.body;
  if (!post.id) post.id = uuidv4();
  post.status = "draft"; post.updatedAt = Date.now();
  if (!post.createdAt) post.createdAt = Date.now();
  const posts = getPersistentPosts();
  const idx   = posts.findIndex(p => p.id === post.id);
  if (idx >= 0) posts[idx] = post; else posts.push(post);
  savePersistentPosts(posts);
  res.json(post);
});
app.delete("/api/posts/drafts/:id", mutationRateLimiter, (req: Request, res: Response) => {
  const posts = getPersistentPosts();
  const next  = posts.filter(p => String(p.id) !== String(req.params.id));
  if (next.length === posts.length) return res.status(404).json({ error: "Draft not found" });
  savePersistentPosts(next);
  res.json({ success: true });
});

// Scheduled
app.get("/api/posts/scheduled", (_req: any, res: any) =>
  res.json(getPersistentPosts().filter(p => p.status === "scheduled"))
);

app.get("/api/posts/published", (_req: any, res: any) =>
  res.json(getPersistentPublishedPosts())
);
app.delete("/api/posts/published/:id", mutationRateLimiter, (req: Request, res: Response) => {
  const published = getPersistentPublishedPosts();
  const next = published.filter((p: any) => String(p.id) !== String(req.params.id));
  savePersistentPublishedPosts(next);
  res.json({ success: true });
});
app.post("/api/posts/schedule", mutationRateLimiter, (req: Request, res: Response) => {
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
  savePersistentPosts(posts);
  res.json(posts[idx] || upd);
});

app.post("/api/posts/publish", mutationRateLimiter, async (req: Request, res: Response) => {
  if (!DEFAULT_CHAT_ID) return res.status(400).json({ error: "Chat ID not set" });
  try {
    const post = req.body;
    if (!post || !post.text) return res.status(400).json({ error: "Invalid post data" });
    await publishPostToTelegram(post, req.headers.host || "");
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Templates — Buttons
app.get("/api/posts/templates/buttons", (_req: any, res: any) =>
  res.json(getPersistentTemplates().buttons)
);
app.post("/api/posts/templates/buttons", mutationRateLimiter, (req: Request, res: Response) => {
  const t    = req.body;
  const tmpl = getPersistentTemplates();
  if (!t.id) {
    const ex = tmpl.buttons.find((x: any) => x.name === t.name);
    t.id = ex ? ex.id : uuidv4();
  }
  const i = tmpl.buttons.findIndex((x: any) => x.id === t.id);
  if (i >= 0) tmpl.buttons[i] = t; else tmpl.buttons.push(t);
  savePersistentTemplates(tmpl);
  addLog(`💾 Button template: ${t.name}`);
  res.json(t);
});
app.delete("/api/posts/templates/buttons/:id", mutationRateLimiter, (req: Request, res: Response) => {
  const tmpl = getPersistentTemplates();
  const was  = tmpl.buttons.length;
  tmpl.buttons = tmpl.buttons.filter((t: any) => t.id !== req.params.id && t.name !== req.params.id);
  savePersistentTemplates(tmpl);
  res.json({ success: true, deletedCount: was - tmpl.buttons.length });
});

// Templates — Reactions
app.get("/api/posts/templates/reactions", (_req: any, res: any) =>
  res.json(getPersistentTemplates().reactions || [])
);
app.post("/api/posts/templates/reactions", mutationRateLimiter, (req: Request, res: Response) => {
  const t    = req.body; if (!t.id) t.id = uuidv4();
  const tmpl = getPersistentTemplates();
  if (!tmpl.reactions) tmpl.reactions = [];
  const i = tmpl.reactions.findIndex((x: any) => x.id === t.id);
  if (i >= 0) tmpl.reactions[i] = t; else tmpl.reactions.push(t);
  savePersistentTemplates(tmpl);
  res.json(t);
});
app.delete("/api/posts/templates/reactions/:id", mutationRateLimiter, (req: Request, res: Response) => {
  const tmpl = getPersistentTemplates();
  tmpl.reactions = (tmpl.reactions || []).filter((t: any) => t.id !== req.params.id);
  savePersistentTemplates(tmpl);
  res.json({ success: true });
});

// Test
app.post("/api/test-key", aiRateLimiter, async (req: Request, res: Response) => {
  const { apiKey, provider } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });
  
  try {
    let url = "";
    let body: any = {};
    let headers: any = { "Content-Type": "application/json" };
    
    if (provider === "github") {
      url = "https://models.inference.ai.azure.com/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      body = { model: "gpt-4o", messages: [{ role: "user", content: "Hello" }], max_tokens: 10 };
    } else if (provider === "openrouter" || provider === "openrouter2") {
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      body = { 
        model: provider === "openrouter" ? "nvidia/nemotron-3-super-120b-a12b:free" : "openai/gpt-oss-120b:free", 
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10
      };
    } else if (provider === "deepseek") {
      url = "https://api.deepseek.com/chat/completions";
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      body = { model: "deepseek-chat", messages: [{ role: "user", content: "Hello" }], max_tokens: 10 };
    } else {
      return res.status(400).json({ error: "Unsupported provider for testing" });
    }

    const r = await axios.post(url, body, { headers, timeout: 15000 });
    if (r.data.choices?.[0]?.message?.content || r.data.choices?.[0]?.text) {
      return res.json({ success: true, provider });
    }
    res.status(400).json({ error: "Empty response from provider" });
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(400).json({ error: msg });
  }
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
  const targetPath = dirPath ? String(dirPath) : process.cwd();
  try {
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: "Path not found" });
    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) return res.status(400).json({ error: "Not a directory" });

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
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

    // ✅ ВМЕСТО ЭТОГО:
    addLog("⚠️ No token loaded. Please set token via UI to start the bot.");
    addLog("💡 Tip: Create a NEW token in @BotFather to avoid conflicts");

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
            await publishPostToTelegram(post, process.env.PUBLIC_DOMAIN || 'http://localhost:3000');
            
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
      if (changed) savePersistentPosts(posts);
    }, 60000);

  } catch (err) {
    console.error("FATAL: Server start failed", err);
    process.exit(1);
  }
}

startServer();