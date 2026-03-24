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
  
  // Если есть кука SESS, тоже считаем сессию активной
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
const DEFAULT_CHAT_ID = "-1002603084916";
let lastChatId: string | number | null = "-1002603084916";
let botStatus: 'offline' | 'starting' | 'waiting' | 'active' = 'offline';
let botWaitRemaining = 0;
let currentBotToken = getPersistentToken();

// ==========================================
// 0. АБСОЛЮТНЫЙ ПРИОРИТЕТ (API ДЛЯ ЭМУЛЯТОРА)
// ==========================================

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

app.get("/api/config/status", (req, res) => {
  const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  res.json({
    hasServerKey: !!(envKey && envKey.trim().length > 10),
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

// Bot Logic & Other APIs
function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  logs.push(`[${timestamp}] ${msg}`);
  if (logs.length > 50) logs.shift();
  console.log(msg);
}

let bot: Telegraf | null = null;

async function initBot(token: string) {
  addLog(`initBot called with token: ${token.substring(0, 5)}...`);
  if (bot) {
    try {
      addLog("Stopping existing bot instance...");
      await bot.stop();
    } catch (e) {
      addLog(`Error stopping bot: ${e}`);
    }
  }

  if (!token || token.trim().length < 10) {
    botStatus = 'offline';
    addLog("❌ Bot token is empty or invalid.");
    return;
  }

  try {
    botStatus = 'starting';
    addLog(`Initializing bot with token length ${token.length}...`);
    bot = new Telegraf(token);

    bot.start((ctx) => {
      lastChatId = ctx.chat.id;
      addLog(`✅ Bot started in chat: ${lastChatId}`);
      ctx.reply("Бот активен и готов к работе!");
    });

    bot.command('status', (ctx) => {
      ctx.reply(`Статус: Активен\nВерсия: 5.0\nЗадач в очереди: ${tasks.filter(t => t.status === 'pending').length}`);
    });

    bot.on('text', (ctx) => {
      lastChatId = ctx.chat.id;
      addLog(`📩 Message from ${ctx.chat.id}: ${ctx.message.text}`);
    });

    addLog("Launching bot...");
    await bot.launch();
    botStatus = 'active';
    currentBotToken = token;
    savePersistentToken(token);
    addLog("🚀 Bot successfully launched and active!");
  } catch (err: any) {
    botStatus = 'offline';
    addLog(`❌ Bot launch error: ${err.message}`);
    if (err.message.includes('401')) {
      addLog("⚠️ Invalid bot token (401). Please check your token from @BotFather.");
    }
    if (err.message.includes('404')) {
      addLog("⚠️ Bot token not found (404).");
    }
  }
}

// Initial bot start
if (currentBotToken) {
  initBot(currentBotToken).catch(e => addLog(`Initial bot start failed: ${e}`));
}

app.get("/api/config/token", (req, res) => {
  res.json({ message: "Use POST to update token", status: "ready", botStatus });
});

app.post(["/api/config/update", "/api/config/token"], async (req, res) => {
  const { token, chatId } = req.body;
  addLog(`Config update request received at ${req.path} from ${req.ip}. Body: ${JSON.stringify(req.body).substring(0, 50)}...`);
  
  if (token) {
    addLog(`Updating bot token...`);
    await initBot(token);
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

// 404 Handler
app.use((req, res) => {
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

startServer();
