import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Telegraf } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();

// 1. MANDATORY: CORS must be the VERY FIRST middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Always reflect the origin or use *
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// 2. Request logging
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const method = req.method;
  const path = req.path;
  addLog(`[Request] ${method} ${path} from ${origin || 'No Origin'}`);
  next();
});
app.use(express.json({ limit: '50mb' }));
const PORT = 3000;

// In-memory state
const logs: string[] = [];
const tasks: any[] = []; // Pending AI tasks
const DEFAULT_CHAT_ID = "-1002603084916";
let lastChatId: string | number | null = "-1002603084916";
let botStatus: 'offline' | 'starting' | 'waiting' | 'active' = 'offline';
let botWaitRemaining = 0;
let currentBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
let bot = new Telegraf(currentBotToken);

function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  logs.push(`[${timestamp}] ${msg}`);
  if (logs.length > 50) logs.shift();
  console.log(msg);
}

// Helper to scrape news
async function scrapeNews(url: string) {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000, // 10s timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    const $ = cheerio.load(data);
    
    const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled News';
    
    let text = '';
    // Try common article selectors
    $('article p, .article-content p, .entry-content p, .post-content p, .content p, main p, .td-post-content p, .post-body p').each((_, el) => {
      const pText = $(el).text().trim();
      if (pText.length > 20) text += pText + '\n\n';
    });
    
    // Fallback 1: Any div with a lot of text
    if (!text || text.length < 200) {
      $('div').each((_, el) => {
        const divText = $(el).clone().children('script, style, nav, footer, header, aside').remove().end().text().trim();
        if (divText.length > 500 && !$(el).find('div').length) { // Leaf div with lots of text
           text += divText + '\n\n';
        }
      });
    }

    // Fallback 2: General p tags
    if (!text || text.length < 100) {
      $('p').each((_, el) => {
        const pText = $(el).text().trim();
        if (pText.length > 40) text += pText + '\n\n';
      });
    }

    if (!text || text.length < 50) {
      addLog(`Warning: No significant text found for ${url}. Attempting raw body text.`);
      text = $('body').clone().children('script, style, nav, footer, header, aside').remove().end().text().replace(/\s+/g, ' ').trim().slice(0, 5000);
    }

    if (!text) {
      addLog(`Warning: No text found for ${url}`);
    }

    const images: string[] = [];
    // Improved image scraping: look for og:image, then article images, then general images
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && ogImage.startsWith('http')) {
      images.push(ogImage);
    }

    $('article img, .article-content img, .entry-content img, .post-content img, main img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('srcset')?.split(' ')[0];
      if (src && src.startsWith('http') && !images.includes(src)) {
        // Filter out small icons or tracking pixels
        const width = $(el).attr('width');
        const height = $(el).attr('height');
        if (width && parseInt(width) < 100) return;
        if (height && parseInt(height) < 100) return;
        
        images.push(src);
      }
    });

    // Fallback to any large images if none found
    if (images.length === 0) {
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.startsWith('http')) {
          images.push(src);
        }
      });
    }

    return { title, text: text.slice(0, 10000), images: images.slice(0, 5) };
  } catch (err) {
    addLog(`Scraping error for ${url}: ${err}`);
    return null;
  }
}

// Bot Logic
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const urlMatch = message.match(/https?:\/\/[^\s]+/);
  
  lastChatId = ctx.chat.id;
  addLog(`Received message from ${ctx.from?.username || ctx.from?.id} (Chat ID: ${ctx.chat.id})`);
  
  let sourceTitle = "Telegram Message";
  let sourceText = message;
  let isLink = false;
  let news = null;

  if (urlMatch) {
    const url = urlMatch[0];
    addLog(`Detected URL: ${url}`);
    ctx.sendChatAction('typing');
    ctx.reply('Scraping news... ⏳');
    news = await scrapeNews(url);
    if (news) {
      sourceTitle = news.title;
      sourceText = news.text;
      isLink = true;
    } else {
      return ctx.reply('Failed to scrape news from the link.');
    }
  }

  ctx.reply('Processing text with AI... ⏳');

  // Create task for frontend
  const taskId = uuidv4();
  addLog(`Creating AI task ${taskId} for chat ${ctx.chat.id}`);
  
  tasks.push({
    id: taskId,
    status: 'pending',
    data: {
      title: sourceTitle,
      text: sourceText,
      images: news ? news.images : []
    },
    chatId: ctx.chat.id,
    replyToMessageId: ctx.message.message_id
  });
});

async function startServer() {
  // API for logs
  app.get("/api/logs", (req, res) => {
    res.json({ logs });
  });

  app.get("/api/ping", (req, res) => {
    res.send("pong");
  });

  app.get("/api/status", (req, res) => {
    res.json({ 
      status: "running", 
      bot: botStatus, 
      botWaitRemaining,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      hasDefaultChat: !!DEFAULT_CHAT_ID,
      lastChatId: lastChatId
    });
  });

  app.post("/api/process-url", async (req, res) => {
    const { url, chatId } = req.body;
    // Priority: Explicit ID > Default Env ID > Last seen ID > Hardcoded target ID
    const targetChatId = chatId || DEFAULT_CHAT_ID || lastChatId || "-1002603084916";

    if (!url) return res.status(400).send("URL is required");
    if (!targetChatId) return res.status(400).send("Target Chat ID is required");

    addLog(`Manual URL request: ${url} for chat ${targetChatId}`);
    
    const news = await scrapeNews(url);
    if (!news) {
      return res.status(500).send("Failed to scrape news");
    }

    const taskId = uuidv4();
    tasks.push({
      id: taskId,
      status: 'pending',
      data: {
        title: news.title,
        text: news.text,
        images: news.images
      },
      chatId: targetChatId,
      replyToMessageId: null // No reply for manual input
    });

    res.json({ success: true, taskId });
  });

  // Task API for Frontend AI Worker
  app.get("/api/tasks", (req, res) => {
    // Reset tasks that have been 'processing' for more than 2 minutes
    const now = Date.now();
    tasks.forEach(t => {
      if (t.status === 'processing' && t.startTime && (now - t.startTime > 120000)) {
        addLog(`Resetting stuck task ${t.id}`);
        t.status = 'pending';
        delete t.startTime;
      }
    });

    const pending = tasks.find(t => t.status === 'pending');
    if (pending) {
      pending.status = 'processing';
      pending.startTime = Date.now();
      res.json(pending);
    } else {
      res.json(null);
    }
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const { id } = req.params;
    const { adaptedText } = req.body;
    const taskIndex = tasks.findIndex(t => t.id === id);
    
    if (taskIndex === -1) {
      addLog(`Task ${id} not found for completion.`);
      return res.status(404).send("Task not found");
    }
    
    const task = tasks[taskIndex];
    addLog(`Completing task ${id} for chat ${task.chatId}`);

    try {
      const images = task.data.images || [];
      const MAX_CAPTION_LENGTH = 1024;
      
      if (images.length > 0) {
        // Send with images
        try {
          const caption = adaptedText.length > MAX_CAPTION_LENGTH 
            ? adaptedText.slice(0, MAX_CAPTION_LENGTH - 3) + "..." 
            : adaptedText;

          if (images.length === 1) {
            await bot.telegram.sendPhoto(task.chatId, images[0], {
              caption: caption,
              parse_mode: 'HTML',
              reply_parameters: task.replyToMessageId ? { message_id: task.replyToMessageId } : undefined
            });
          } else {
            const mediaGroup = images.map((url: string, index: number) => ({
              type: 'photo',
              media: url,
              caption: index === 0 ? caption : undefined,
              parse_mode: index === 0 ? 'HTML' : undefined
            }));
            await bot.telegram.sendMediaGroup(task.chatId, mediaGroup, {
              reply_parameters: task.replyToMessageId ? { message_id: task.replyToMessageId } : undefined
            });
          }
          
          // If caption was truncated, send the full text as a follow-up
          if (adaptedText.length > MAX_CAPTION_LENGTH) {
            await bot.telegram.sendMessage(task.chatId, adaptedText, {
              parse_mode: 'HTML'
            });
          }
          
          addLog(`Task ${id} sent successfully with images.`);
        } catch (imgErr) {
          addLog(`Error sending images for task ${id}, falling back to text only: ${imgErr}`);
          await sendTextOnly(task, adaptedText);
        }
      } else {
        await sendTextOnly(task, adaptedText);
      }
      
      tasks.splice(taskIndex, 1);
      res.json({ success: true });
    } catch (err) {
      addLog(`Final send error for task ${id}: ${err}`);
      tasks.splice(taskIndex, 1);
      res.status(500).send("Error sending to Telegram");
    }
  });

  async function sendTextOnly(task: any, text: string) {
    try {
      await bot.telegram.sendMessage(task.chatId, text, { 
        parse_mode: 'HTML',
        reply_parameters: task.replyToMessageId ? { message_id: task.replyToMessageId } : undefined
      });
      addLog(`Task ${task.id} sent successfully with HTML.`);
    } catch (htmlError) {
      addLog(`HTML parse error for task ${task.id}, falling back to plain text: ${htmlError}`);
      await bot.telegram.sendMessage(task.chatId, text, { 
        reply_parameters: task.replyToMessageId ? { message_id: task.replyToMessageId } : undefined
      });
      addLog(`Task ${task.id} sent successfully as plain text.`);
    }
  }

  app.post("/api/config/token", async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).send("Token is required");
    }

    addLog("Received new bot token. Restarting bot...");
    currentBotToken = token;
    
    // Stop current bot
    try {
      await bot.stop();
    } catch (e) {}

    // Create new bot instance
    bot = new Telegraf(currentBotToken);
    setupBotHandlers(); // Re-attach handlers
    
    // Start bot
    startBot();
    
    res.json({ status: "ok", message: "Bot token updated. Restarting..." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    addLog("Starting Vite in middleware mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: process.cwd(),
    });
    app.use(vite.middlewares);
    
    // Fallback for SPA in dev mode if vite middleware doesn't catch it
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      res.sendFile(path.join(process.cwd(), 'index.html'));
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    addLog(`Serving static files from ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bot handlers setup
  function setupBotHandlers() {
    bot.start((ctx) => {
      lastChatId = ctx.chat.id;
      addLog(`Bot started in chat: ${ctx.chat.id}`);
      ctx.reply("Бот активен! Теперь я буду присылать сюда новости.");
    });

    bot.on("text", (ctx) => {
      lastChatId = ctx.chat.id;
      addLog(`Message from ${ctx.chat.id}: ${ctx.message.text}`);
    });
  }

  // Start Bot Logic
  async function startBot() {
    if (!currentBotToken) {
      addLog("TELEGRAM_BOT_TOKEN is not set. Bot will not start.");
      return;
    }

    const maxRetries = 10;
    let retryCount = 0;

    const launchBot = async () => {
      try {
        botStatus = 'starting';
        addLog(`Initializing Telegram bot startup sequence (Attempt ${retryCount + 1}/${maxRetries})...`);
        
        // Verify token first
        try {
          const me = await bot.telegram.getMe();
          addLog(`Bot token verified for: @${me.username} (${me.first_name})`);
        } catch (tokenErr: any) {
          botStatus = 'offline';
          addLog(`CRITICAL: Token verification failed: ${tokenErr.message}`);
          if (tokenErr.message?.includes("401") || tokenErr.message?.includes("404")) {
            addLog("Please check if your TELEGRAM_BOT_TOKEN is correct.");
            return;
          }
        }

        // Try to stop any existing polling if possible
        try {
          await bot.stop();
        } catch (e) {}

        addLog("Deleting webhooks and dropping pending updates...");
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        
        botStatus = 'waiting';
        botWaitRemaining = 45;
        addLog(`Waiting 45 seconds to ensure previous connections are closed...`);
        
        const waitInterval = setInterval(() => {
          if (botWaitRemaining > 0) botWaitRemaining--;
          else clearInterval(waitInterval);
        }, 1000);

        await new Promise(resolve => setTimeout(resolve, 45000));
        clearInterval(waitInterval);
        botWaitRemaining = 0;
        
        botStatus = 'active';
        addLog("Launching bot...");
        bot.launch({ dropPendingUpdates: true }).catch(err => {
          botStatus = 'offline';
          addLog(`Bot polling error: ${err.message}`);
        });
        addLog("Bot started successfully and is polling for updates.");
      } catch (err: any) {
        botStatus = 'offline';
        if (err.message?.includes("409: Conflict")) {
          addLog("Bot conflict detected (409). Another instance might be shutting down.");
          if (retryCount < maxRetries) {
            retryCount++;
            addLog(`Retrying in 20 seconds... (${retryCount}/${maxRetries})`);
            setTimeout(launchBot, 20000);
          } else {
            addLog("CRITICAL: Max retries reached. Bot failed to start due to persistent conflict.");
          }
        } else {
          addLog(`Bot failed to start: ${err.message || err}`);
        }
      }
    };

    launchBot();
  }

  setupBotHandlers();

  app.listen(PORT, "0.0.0.0", () => {
    addLog(`Server running on http://localhost:${PORT}`);
    startBot();
  });
}

startServer();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
