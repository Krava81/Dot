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
import { parseWeChat, getLogs as getWechatLogs } from './wechatParser'; // FIX 4: removed unused clearLogs
import { processNewsText } from './src/services/geminiService';

dotenv.config();

const app = express();
const TOKEN_FILE = path.join(process.cwd(), 'bot_token.txt');

// v5.0: Хранилище сессий для ручной синхронизации
const activeSessions = new Set<string>();

// 1. CORS (Должен быть первым!)
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

// Helper to get bot token persistently
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

// State
const logs: string[] = [];
const tasks: any[] = [];
// FIX 7: Move DEFAULT_CHAT_ID to .env. Fallback kept for backwards compatibility.
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

// FIX 2: initBot was used but never defined — added here
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
    // Stop existing bot instance if running
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

    // Basic command handlers
    bot.start((ctx) => ctx.reply("Bot is active ✅"));
    bot.help((ctx) => ctx.reply("Send a news URL to process."));

    // Launch in background (no await — long-polling runs async)
    bot.launch().catch((e) => {
      addLog(`❌ Bot launch error: ${e.message}`);
      botStatus = 'offline';
    });

    // Graceful shutdown
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
// 0. АБСОЛЮТНЫЙ ПРИОРИТЕТ (API ДЛЯ ЭМУЛЯТОРА)
// ==========================================

app.get("/api/status-root", (req, res) => {
  res.json({
    status: "running",
    version: "5.0",
    message: "Telegram News Bot Server"
  });
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
  if (!envKey || envKey.includes('undefined') || envKey.includes('null')) {
    addLog(`⚠️ No valid API key in environment. Using client-provided key.`);
  }
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
  } else if (envKey && envKey.trim().length > 10) {
    addLog(`⚠️ API Key check skipped: Placeholder detected or invalid format.`);
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

// v5.0: Улучшенная синхронизация через полный набор Cookie
app.get("/api/auth/sync", (req, res) => {
  const cookies = req.headers.cookie || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Синхронизация v5.0</title>
      <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: white; text-align: center; padding: 20px; box-sizing: border-box; }
        .card { background: #1a1a1a; padding: 2rem; border-radius: 1.5rem; border: 1px solid #333; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 100%; max-width: 400px; }
        .icon { font-size: 3rem; margin-bottom: 1rem; color: #10b981; }
        h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
        p { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; }
        .token-box { background: #000; border: 1px dashed #444; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1.5rem; word-break: break-all; font-family: monospace; font-size: 0.7rem; color: #3b82f6; max-height: 100px; overflow-y: auto; }
        .btn { background: #3b82f6; color: white; border: none; padding: 0.8rem 2rem; border-radius: 0.75rem; font-weight: bold; cursor: pointer; transition: all 0.2s; width: 100%; margin-bottom: 10px; display: block; text-decoration: none; }
        .btn:active { transform: scale(0.98); }
        .success-msg { color: #10b981; font-size: 0.8rem; margin-top: 10px; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✅</div>
        <h1>Авторизация успешна</h1>
        <p>Ключ синхронизации получен. Скопируйте его полностью и вставьте в настройки приложения.</p>
        <div class="token-box" id="token">${cookies || 'Ошибка: Cookie не найдены.'}</div>
        <button class="btn" onclick="copyToken()">Копировать ключ</button>
        <div id="copy-success" class="success-msg">Скопировано!</div>
        <p style="margin-top: 20px; font-size: 0.7rem;">Вернитесь в приложение и вставьте этот текст в поле "Токен сессии".</p>
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
      addLog("Stopping existing bot instance...");
      await bot.stop();
      await new Promise(resolve => setTimeout(resolve, 2000));
      addLog("Existing bot stopped.");
    } catch (e) {
      addLog(`Error stopping bot: ${e}`);
    }
    bot = null;
  }
  res.json({ status: "reset", message: "Bot state reset successfully." });
});

app.post(["/api/config/update", "/api/config/token"], async (req, res) => {
  const { token, chatId } = req.body;
  addLog(`Config update request received at ${req.path} from ${req.ip}. Body: ${JSON.stringify(req.body).substring(0, 50)}...`);

  if (token) {
    if (token === currentBotToken && botStatus === 'active') {
      addLog("Bot is already active with this token, skipping re-init.");
    } else {
      addLog(`Updating bot token...`);
      currentBotToken = token;
      initBot(token).catch(err => addLog(`❌ Background bot init error: ${err.message}`));
    }
  }

  if (chatId) {
    lastChatId = chatId;
    addLog(`Chat ID updated to: ${chatId}`);
  }

  res.json({
    status: "ok",
    botStatus,
    chatId: lastChatId,
    tokenSet: !!token
  });
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
          return res.status(400).json({ error: "API key is required for server-side processing" });
        }
        try {
          addLog(`🤖 Server-side processing for task ${id}...`);
          adaptedText = await processNewsText(task.data.title, task.data.text, apiKey);
          addLog(`✅ Server-side processing completed for task ${id}`);
        } catch (e: any) {
          addLog(`❌ Server-side processing failed for task ${id}: ${e.message}`);
          adaptedText = `⚠️ Ошибка при обработке новости: ${e.message}`;
        }
      }

      // ЭТАП 2: Отправка в Telegram (ПЕРЕД пометкой как completed!)
      if (bot && lastChatId) {
        addLog(`🔍 Attempting to send to Telegram. ChatID: ${lastChatId}, Images: ${task.data.images?.length || 0}`);
        try {
          const imageUrls = task.data.images || [];
          if (imageUrls.length > 0) {
            addLog(`📸 Downloading ${imageUrls.length} images to send as buffers...`);

            const mediaGroup: any[] = [];
            const caption = adaptedText.length <= 1024 ? adaptedText : "";

            for (let i = 0; i < imageUrls.length; i++) {
              const imgUrl = imageUrls[i];
              try {
                addLog(`⬇️ Downloading image ${i + 1}: ${imgUrl.substring(0, 50)}...`);
                const imgRes = await axios.get(imgUrl, {
                  responseType: 'arraybuffer',
                  timeout: 15000,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://mp.weixin.qq.com/',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                  },
                  withCredentials: false,
                  maxRedirects: 5
                });

                // FIX 1: Removed orphaned duplicate block — this is the single correct version
                if (imgRes.data && imgRes.data.byteLength > 1000) {
                  const contentType = imgRes.headers['content-type'] || '';
                  if (!contentType || !contentType.includes('image/')) {
                    addLog(`⚠️ Invalid content type for image ${i + 1}: ${contentType}, skipping`);
                    continue;
                  }

                  const isWebp = imgUrl.toLowerCase().includes('webp') || contentType.includes('webp');
                  mediaGroup.push({
                    type: 'photo',
                    media: {
                      source: Buffer.from(imgRes.data),
                      filename: `image_${i}.${isWebp ? 'webp' : 'jpg'}`
                    },
                    caption: i === 0 ? caption : undefined
                  });
                  addLog(`✅ Image ${i + 1} downloaded.`);
                } else {
                  addLog(`⚠️ Image ${i + 1} is too small or empty, skipping.`);
                }
              } catch (imgErr: any) {
                addLog(`⚠️ Failed to download image ${i + 1}: ${imgErr.message}`);
              }
            }

            addLog(`📤 Sending media group to Telegram...`);
            if (mediaGroup.length > 0) {
              await bot.telegram.sendMediaGroup(lastChatId, mediaGroup);
              addLog(`✅ Media group sent.`);
              if (adaptedText.length > 1024) {
                const cleanText = adaptedText.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
                await bot.telegram.sendMessage(lastChatId, cleanText);
                addLog(`✅ Caption sent.`);
              }
            } else {
              addLog(`⚠️ No media to send, sending text only.`);
              const cleanText = adaptedText.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
              await bot.telegram.sendMessage(lastChatId, cleanText);
            }
          } else {
            addLog(`📤 Sending text only to Telegram...`);
            const cleanText = adaptedText.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
            await bot.telegram.sendMessage(lastChatId, cleanText);
            addLog(`✅ Text sent.`);
          }
          addLog(`✅ Message sent to Telegram (${lastChatId})`);
        } catch (e: any) {
          addLog(`❌ Error sending to Telegram: ${e.message}`);
          try {
            await bot.telegram.sendMessage(lastChatId, adaptedText);
            addLog(`✅ Fallback: Text-only message sent.`);
          } catch (e2: any) {
            addLog(`❌ Fallback failed: ${e2.message}`);
          }
        }
      } else {
        addLog(`⚠️ Cannot send to Telegram: bot or chatId missing. Bot: ${!!bot}, ChatId: ${lastChatId}`);
      }

      // ЭТАП 3: ТОЛЬКО ПОСЛЕ отправки помечаем как завершённую
      task.status = 'completed';
      task.adaptedText = adaptedText;
      addLog(`✅ Task ${id} completed.`);

      const pendingTask = tasks.find(t => t.status === 'pending');
      if (!pendingTask) {
        botStatus = 'waiting';
      }

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
      addLog(`🔗 Обнаружена WeChat ссылка, используем специальный парсер...`);
      result = await parseWeChat(url);

      const wechatLogs = getWechatLogs();
      wechatLogs.forEach(log => addLog(log));
    } else {
      addLog(`🌐 Загрузка обычной ссылки...`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
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

      if (text.length < 100) {
        text = $('article').text() || $('main').text() || $('body').text();
      }

      const images: string[] = [];
      $('img').each((i, el) => {
        if (images.length >= 10) return;
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && !src.startsWith('data:')) {
          images.push(src);
        }
      });

      result = {
        title,
        text: text.substring(0, 10000),
        images,
        debug: []
      };
    }

    const { title, text, images } = result;

    addLog(`✅ Parsing complete:`);
    addLog(`   📰 Title: ${title.substring(0, 60)}`);
    addLog(`   📝 Text: ${text.length} chars`);
    addLog(`   🖼️ Images: ${images.length}`);

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

app.get("/api/tasks/all", (req, res) => {
  res.json(tasks);
});

app.post("/api/tasks", (req, res) => {
  const { type, data } = req.body;
  const newTask = {
    id: uuidv4(),
    type,
    data,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  tasks.push(newTask);
  addLog(`New task added: ${type} (${newTask.id})`);
  res.json(newTask);
});

// FIX 3: Moved /api/test-key BEFORE the 404 handler so it's reachable
app.post('/api/test-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: "API key is required" });
  }
  try {
    await processNewsText("Test", "This is a test message to verify the API key.", apiKey);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// 404 Handler for API routes (must be LAST among /api routes)
app.use('/api', (req, res) => {
  addLog(`⚠️ 404 Not Found: ${req.method} ${req.url} from ${req.ip}`);
  res.status(404).json({
    error: "API Route Not Found",
    path: req.url,
    method: req.method,
    version: "5.0"
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
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

// Initial bot start (after all routes and functions are defined)
currentBotToken = getPersistentToken();
if (currentBotToken) {
  initBot(currentBotToken).catch(e => addLog(`Initial bot start failed: ${e}`));
}

startServer();
