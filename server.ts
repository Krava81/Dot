import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Telegraf } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
// FIX 1: Исправлен путь импорта
import { parseWeChat, getLogs as getWechatLogs } from './wechatParser.js';
import { processNewsText } from './src/services/geminiService.js';

dotenv.config();

const app = express();
const TOKEN_FILE = path.join(process.cwd(), 'bot_token.txt');

// v5.0: Хранилище сессий для ручной синхронизации
const activeSessions = new Set<string>();

// 1. CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Session-Token', 'X-App-Version']
}));

app.use(express.json({ limit: '50mb' }));

// 2. Middleware для проверки сессии
app.use((req, res, next) => {
  res.setHeader('X-App-Version', '5.0');
  const token = req.headers['x-session-token'] as string ||
    (req.headers['authorization'] as string)?.replace('Bearer ', '');

  if (token && token.length > 10) {
    activeSessions.add(token);
  }

  const cookies = req.headers.cookie || '';
  const sessionCookie = cookies.split('; ').find(row => row.startsWith('SESS='));
  if (sessionCookie) {
    const cookieToken = sessionCookie.split('=')[1];
    if (cookieToken) activeSessions.add(cookieToken);
  }

  next();
});

function getPersistentToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch (e) {
    console.error("Error reading token file:", e);
  }
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function savePersistentToken(token: string) {
  try {
    fs.writeFileSync(TOKEN_FILE, token, 'utf8');
  } catch (e) {
    console.error("Error saving token file:", e);
  }
}

const logs: string[] = [];
const tasks: any[] = [];
const DEFAULT_CHAT_ID = process.env.DEFAULT_CHAT_ID || "-1002603084916";
let lastChatId: string | number | null = DEFAULT_CHAT_ID;
let botStatus: 'offline' | 'starting' | 'waiting' | 'active' = 'offline';
let botWaitRemaining = 0;
let currentBotToken = '';
let bot: Telegraf | null = null;
let isInitializing = false;

function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  logs.push(`[${timestamp}] ${msg}`);
  if (logs.length > 50) logs.shift();
  console.log(msg);
}

async function initBot(token: string): Promise<void> {
  if (isInitializing) {
    addLog("⚠️ Bot is already initializing, skipping duplicate call.");
    return;
  }

  if (!token || token.trim().length < 10) {
    addLog("❌ initBot: Invalid token provided.");
    return;
  }

  isInitializing = true;
  botStatus = 'starting';
  addLog("🤖 Initializing Telegraf bot...");

  try {
    if (bot) {
      try {
        addLog("Stopping existing bot instance...");
        await bot.stop();
        await new Promise(resolve => setTimeout(resolve, 2000));
        addLog("Existing bot stopped.");
      } catch (e) {
        addLog(`Warning: error stopping previous bot: ${e}`);
      }
      bot = null;
    }

    bot = new Telegraf(token.trim());
    savePersistentToken(token.trim());
    currentBotToken = token.trim();

    bot.start((ctx) => ctx.reply("Bot is active ✅"));
    bot.help((ctx) => ctx.reply("Send a news URL to process."));

    bot.launch().catch((e) => {
      addLog(`❌ Bot launch error: ${e.message}`);
      botStatus = 'offline';
    });

    process.once('SIGINT', () => bot?.stop('SIGINT'));
    process.once('SIGTERM', () => bot?.stop('SIGTERM'));

    botStatus = 'waiting';
    addLog("✅ Bot initialized and running.");
  } catch (e: any) {
    addLog(`❌ initBot failed: ${e.message}`);
    botStatus = 'offline';
  } finally {
    isInitializing = false;
  }
}

// ==========================================
// API ROUTES
// ==========================================

app.get("/api/status-root", (req, res) => {
  res.json({ status: "running", version: "5.0", message: "Telegram News Bot Server" });
});

app.get("/api/status", (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    status: "running",
    version: "5.0",
    bot: botStatus,
    botWaitRemaining,
    pendingTasks: tasks.filter(t => t.status === 'pending').length,
    hasDefaultChat: !!DEFAULT_CHAT_ID,
    lastChatId: lastChatId,
    env: process.env.NODE_ENV || 'development',
    time: new Date().toISOString(),
    auth: req.headers['authorization'] ? 'present' : 'missing'
  });
});

app.get("/api/ping", (req, res) => {
  res.json({ status: "pong", time: new Date().toISOString(), version: "5.0" });
});

app.get("/api/sync-check", (req, res) => {
  const cookies = req.headers.cookie || '';
  const hasSess = cookies.includes('SESS=');
  const hasStudio = cookies.includes('AI_STUDIO_AUTH');
  res.json({
    authenticated: hasSess || hasStudio,
    cookies: cookies.split('; ').map(c => c.split('=')[0]),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    version: "5.0"
  });
});

app.get("/api/debug", (req, res) => {
  res.json({
    headers: req.headers,
    cookies: req.headers.cookie,
    method: req.method,
    url: req.url,
    ip: req.ip,
    version: "5.0"
  });
});

app.get("/api/logs", (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({ logs });
});

app.get("/api/config/status", async (req, res) => {
  const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  let keyValid = false;
  let keyError = null;

  if (envKey && envKey.startsWith('AIza') && envKey.trim().length > 10) {
    try {
      const ai = new GoogleGenAI({ apiKey: envKey });
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "ping",
      });
      keyValid = true;
    } catch (e: any) {
      keyError = e.message;
      addLog(`⚠️ API Key check failed: ${e.message}`);
    }
  }

  res.json({
    hasServerKey: !!(envKey && envKey.trim().length > 10),
    keyValid,
    keyError,
    serverKeyMasked: envKey ? `${envKey.substring(0, 4)}...${envKey.substring(envKey.length - 4)}` : null,
    botTokenSet: !!currentBotToken,
    chatId: lastChatId || DEFAULT_CHAT_ID
  });
});

app.get("/api/auth/sync", (req, res) => {
  const cookies = req.headers.cookie || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Синхронизация v5.0</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: white; text-align: center; padding: 20px; }
        .card { background: #1a1a1a; padding: 2rem; border-radius: 1.5rem; border: 1px solid #333; max-width: 400px; width: 100%; }
        .token-box { background: #000; border: 1px dashed #444; padding: 1rem; border-radius: 0.75rem; margin: 1.5rem 0; word-break: break-all; font-family: monospace; font-size: 0.7rem; color: #3b82f6; max-height: 100px; overflow-y: auto; }
        .btn { background: #3b82f6; color: white; border: none; padding: 0.8rem 2rem; border-radius: 0.75rem; cursor: pointer; width: 100%; }
        .success-msg { color: #10b981; display: none; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>✅ Авторизация успешна</h1>
        <p>Скопируйте ключ и вставьте в настройки приложения.</p>
        <div class="token-box" id="token">${cookies || 'Ошибка'}</div>
        <button class="btn" onclick="copyToken()">Копировать ключ</button>
        <div id="copy-success" class="success-msg">Скопировано!</div>
      </div>
      <script>
        function copyToken() {
          const token = document.getElementById('token').innerText;
          navigator.clipboard.writeText(token).then(() => {
            document.getElementById('copy-success').style.display = 'block';
            setTimeout(() => { document.getElementById('copy-success').style.display = 'none'; }, 3000);
          });
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/api/auth/login", (req, res) => {
  const sessionToken = uuidv4();
  res.setHeader('Set-Cookie', `SESS=${sessionToken}; Path=/; Max-Age=2592000; HttpOnly; SameSite=None; Secure`);
  res.json({ status: "ok", token: sessionToken });
});

app.get("/api/config/token", (req, res) => {
  res.json({ message: "Use POST to update token", status: "ready", botStatus });
});

app.get("/api/config/reset", async (req, res) => {
  addLog("⚠️ Manual reset requested.");
  isInitializing = false;
  botStatus = 'offline';
  if (bot) {
    try {
      await bot.stop();
      await new Promise(resolve => setTimeout(resolve, 2000));
      bot = null;
      addLog("Bot stopped.");
    } catch (e) {
      addLog(`Error stopping bot: ${e}`);
    }
  }
  res.json({ status: "reset", message: "Bot state reset successfully." });
});

app.post(["/api/config/update", "/api/config/token"], async (req, res) => {
  const { token, chatId } = req.body;
  addLog(`Config update received.`);

  if (token) {
    if (token !== currentBotToken || botStatus !== 'active') {
      currentBotToken = token;
      initBot(token).catch(err => addLog(`❌ Background bot init error: ${err.message}`));
    }
  }

  if (chatId) {
    lastChatId = chatId;
    addLog(`Chat ID updated to: ${chatId}`);
  }

  res.json({ status: "ok", botStatus, chatId: lastChatId, tokenSet: !!token });
});

app.get("/api/tasks", (req, res) => {
  const pendingTask = tasks.find(t => t.status === 'pending');
  if (pendingTask) {
    pendingTask.status = 'processing';
    botStatus = 'active';
    res.json(pendingTask);
  } else {
    botStatus = 'waiting';
    res.json(null);
  }
});

app.post("/api/tasks/:id/complete", async (req, res) => {
  const { id } = req.params;
  let { adaptedText, apiKey } = req.body;
  const task = tasks.find(t => t.id === id);

  if (task) {
    try {
      // ЭТАП 1: Обработка текста
      if (!adaptedText) {
        if (!apiKey) {
          return res.status(400).json({ error: "API key is required" });
        }
        try {
          addLog(`🤖 Processing task ${id}...`);
          adaptedText = await processNewsText(task.data.title, task.data.text, apiKey);
          addLog(`✅ Processing completed.`);
        } catch (e: any) {
          addLog(`❌ Processing failed: ${e.message}`);
          adaptedText = `⚠️ Ошибка обработки: ${e.message}`;
        }
      }

      // ЭТАП 2: Отправка в Telegram
      if (bot && lastChatId) {
        try {
          const imageUrls = task.data.images || [];
          const mediaGroup: any[] = [];
          const caption = adaptedText.length <= 1024 ? adaptedText : "";

          if (imageUrls.length > 0) {
            for (let i = 0; i < imageUrls.length; i++) {
              const imgUrl = imageUrls[i];
              let imgRes: any = null;

              try {
                imgRes = await axios.get(imgUrl, {
                  responseType: 'arraybuffer',
                  timeout: 15000,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://mp.weixin.qq.com/',
                  }
                });

                if (imgRes.data && imgRes.data.byteLength > 1000) {
                  const contentType = imgRes.headers['content-type'] || '';
                  if (!contentType.includes('image/')) continue;

                  const isWebp = imgUrl.toLowerCase().includes('webp') || contentType.includes('webp');
                  mediaGroup.push({
                    type: 'photo',
                    media: {
                      source: Buffer.from(imgRes.data),
                      filename: `image_${i}.${isWebp ? 'webp' : 'jpg'}`
                    },
                    caption: i === 0 ? caption : undefined
                  });
                }
              } catch (imgErr: any) {
                addLog(`⚠️ Image download failed: ${imgErr.message}`);
              }
            }

            if (mediaGroup.length > 0) {
              await bot.telegram.sendMediaGroup(lastChatId, mediaGroup);
              if (adaptedText.length > 1024) {
                const cleanText = adaptedText.replace(/```[a-z]*\n?/g, '').trim();
                await bot.telegram.sendMessage(lastChatId, cleanText);
              }
            } else {
              const cleanText = adaptedText.replace(/```[a-z]*\n?/g, '').trim();
              await bot.telegram.sendMessage(lastChatId, cleanText);
            }
          } else {
            const cleanText = adaptedText.replace(/```[a-z]*\n?/g, '').trim();
            await bot.telegram.sendMessage(lastChatId, cleanText);
          }
          addLog(`✅ Sent to Telegram.`);
        } catch (e: any) {
          addLog(`❌ Send error: ${e.message}. Trying fallback...`);
          try {
            const cleanText = adaptedText.replace(/```[a-z]*\n?/g, '').trim();
            await bot.telegram.sendMessage(lastChatId, cleanText);
            addLog(`✅ Fallback sent.`);
          } catch (e2: any) {
            addLog(`❌ Fallback failed.`);
          }
        }
      }

      task.status = 'completed';
      task.adaptedText = adaptedText;
      addLog(`✅ Task ${id} completed.`);

      if (!tasks.find(t => t.status === 'pending')) botStatus = 'waiting';
      res.json({ status: "ok" });

    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      addLog(`❌ Task ${id} failed: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(404).json({ error: "Task not found" });
  }
});

app.post("/api/process-url", async (req, res) => {
  const { url } = req.body;
  addLog(`🌐 Processing URL: ${url}`);

  try {
    let result;
    if (url.includes('weixin.qq.com') || url.includes('mp.weixin')) {
      result = await parseWeChat(url);
      getWechatLogs().forEach(log => addLog(log));
    } else {
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000
      });
      const $ = cheerio.load(response.data);
      $('style, script, noscript, iframe, svg').remove();
      const title = $('title').text() || $('h1').first().text() || 'No title';
      let text = '';
      $('p').each((i, el) => {
        const pText = $(el).text().trim();
        if (pText.length > 20) text += pText + '\n';
      });
      if (text.length < 100) text = $('article').text() || $('main').text() || $('body').text();
      
      const images: string[] = [];
      $('img').each((i, el) => {
        if (images.length >= 10) return;
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.startsWith('data:')) images.push(src);
      });

      result = { title, text: text.substring(0, 10000), images, debug: [] };
    }

    const { title, text, images } = result;
    addLog(`✅ Parsing complete: ${title.substring(0, 40)}...`);

    const newTask = {
      id: uuidv4(),
      type: 'news_adaptation',
      data: { url, title, text, images },
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    tasks.push(newTask);
    addLog(`➕ Task added: ${newTask.id}`);
    res.json({ status: "ok", taskId: newTask.id });

  } catch (e: any) {
    addLog(`❌ Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/tasks/all", (req, res) => res.json(tasks));

app.post("/api/tasks", (req, res) => {
  const { type, data } = req.body;
  const newTask = { id: uuidv4(), type, data, status: 'pending', createdAt: new Date().toISOString() };
  tasks.push(newTask);
  addLog(`New task added: ${type}`);
  res.json(newTask);
});

app.post('/api/test-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });
  try {
    await processNewsText("Test", "Test message", apiKey);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.use('/api', (req, res) => {
  addLog(`⚠️ 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "API Route Not Found", path: req.url, method: req.method, version: "5.0" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:3000`);
  });
}

currentBotToken = getPersistentToken();
if (currentBotToken) {
  initBot(currentBotToken).catch(e => addLog(`Initial bot start failed: ${e}`));
}

startServer();
