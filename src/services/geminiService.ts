// src/services/geminiService.ts
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

/**
 * In-memory cache: API key -> working model name
 * (process restarts will clear it)
 */

/**
 * Circuit Breaker state to prevent cascade failures
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'closed'
};

const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
const CIRCUIT_BREAKER_RESET_TIMEOUT = 60000; // 1 minute before trying again

function shouldAllowRequest(): boolean {
  const now = Date.now();
  
  if (circuitBreaker.state === 'closed') {
    return true;
  }
  
  if (circuitBreaker.state === 'open') {
    if (now - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_RESET_TIMEOUT) {
      console.log('[CircuitBreaker] Moving to half-open state');
      circuitBreaker.state = 'half-open';
      return true;
    }
    return false;
  }
  
  // half-open: allow one request
  return true;
}

function recordSuccess() {
  circuitBreaker.failures = 0;
  circuitBreaker.state = 'closed';
}

function recordFailure() {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();
  
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    console.warn(`[CircuitBreaker] Opening circuit after ${circuitBreaker.failures} failures`);
    circuitBreaker.state = 'open';
  }
}

const modelCache = new Map<string, string>();

export async function processNewsText(title: string, text: string, manualApiKey?: string) {
  console.log(`[GeminiService] Processing request: title="${title.substring(0, 50)}...", text length=${text.length}`);
  
  // Check circuit breaker before processing
  if (!shouldAllowRequest()) {
    const waitTime = Math.round((CIRCUIT_BREAKER_RESET_TIMEOUT - (Date.now() - circuitBreaker.lastFailureTime)) / 1000);
    console.warn(`[GeminiService] Circuit breaker is open. Rejecting request.`);
    throw new Error(`Circuit breaker is open. Too many recent failures. Try again in ${waitTime}s`);
  }
  
  const resolveKey = () => {
    if (manualApiKey && manualApiKey.trim().length > 10) {
      console.log("[GeminiService] Using manual API key");
      return manualApiKey.trim();
    }
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey && envKey !== "undefined" && envKey !== "null" && !envKey.includes("{{") && envKey.trim().length > 20) {
      console.log("[GeminiService] Using API key from environment");
      return envKey.trim();
    }
    return "";
  };

  const apiKey = resolveKey();
  if (!apiKey) throw new Error("API ключ не найден. Введите ключ в настройках.");

  const cleanKey = apiKey.trim();
  
  // Validate API key format before proceeding
  const isValidGemini = cleanKey.startsWith("AIza") && cleanKey.length >= 30;
  const isOpenRouter = cleanKey.startsWith("sk-or-") && cleanKey.length >= 20;
  const isGrok = cleanKey.startsWith("xai-") && cleanKey.length >= 20;
  const isGroq = cleanKey.startsWith("gsk_") && cleanKey.length >= 20;
  const isOpenAI = (cleanKey.startsWith("sk-proj-") || (cleanKey.startsWith("sk-") && !isOpenRouter)) && cleanKey.length >= 20;
  
  const isValidKey = isValidGemini || isOpenRouter || isGrok || isGroq || isOpenAI;
  
  if (!isValidKey) {
    console.error(`[GeminiService] Invalid API key format. Length: ${cleanKey.length}, starts with: "${cleanKey.substring(0, 8)}..."`);
    throw new Error("Неверный формат API ключа. Проверьте, что ключ скопирован полностью.");
  }

  const isGemini = isValidGemini;

  console.log(`[GeminiService] Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}, OpenAI=${isOpenAI}`);
console.log(`[GeminiService] API Key format: starts with "${cleanKey.substring(0, 8)}...", length=${cleanKey.length}`);

  const prompt = `Translate the following news article to Russian and adapt it for a Telegram channel.
Make it engaging, readable, and concise. Use emojis.

CRITICAL INSTRUCTIONS:
1. DO NOT use any HTML tags or technical symbols. Output must be plain text.
2. IF THE INPUT TEXT LOOKS LIKE CSS, JAVASCRIPT, OR TECHNICAL CODE, REPLY WITH "Ошибка: присланный текст не является новостью."
3. Divide into clear paragraphs.
4. Keep brand/technical names in English.
5. The rest in Russian.
6. Exclude links to source articles.
7. Add relevant hashtags at the end.

Title: ${title}
Content: ${text}`;

  // --------- GEMINI branch -----------
  if (isGemini) {
    console.log("[GeminiService] Using Google Gemini API");
    const ai = new GoogleGenAI({ apiKey: cleanKey });

    // Use only models that exist for this account (from your list). Priority order.
    const models = [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash-001",
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    // If we've already found a working model for this key, try it first
    const cached = modelCache.get(cleanKey);
    if (cached) {
      console.log(`[GeminiService] Found cached model for this key: ${cached}`);
      // put cached model first
      const idx = models.indexOf(cached);
      if (idx > 0) models.splice(0, 0, models.splice(idx, 1)[0]);
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let lastError: any = null;

    // For each model, try up to N attempts for transient errors
    for (const modelName of models) {
      let attempt = 0;
      const maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          console.log(`[GeminiService] Trying model: ${modelName} (attempt ${attempt}/${maxAttempts})`);
          const timeoutMs = 120000;
          let timeoutId: NodeJS.Timeout | null = null;

          try {
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error(`Gemini timeout (${modelName})`));
              }, timeoutMs);
            });

            const response = (await Promise.race([
              ai.models.generateContent({
                model: modelName,
                contents: prompt
              }),
              timeoutPromise
            ])) as any;

            if (response && response.text && response.text.trim().length > 0) {
              console.log(`[GeminiService] Success with model: ${modelName}`);
              modelCache.set(cleanKey, modelName);
              recordSuccess(); // Reset circuit breaker on success
              return response.text.trim();
            }
            throw new Error(`Empty response from Gemini (${modelName})`);
            
          } catch (err: any) {
            lastError = err;
            const statusCode =
              err?.response?.data?.error?.code ||
              err?.response?.status ||
              err?.code ||
              err?.status ||
              null;
            const msg = (err?.response?.data?.error?.message || err?.message || JSON.stringify(err)).toString();

            console.warn(`[GeminiService] Model ${modelName} failed`);
            console.warn(`  Status/Code: ${statusCode}`);
            console.warn(`  Message: ${msg.substring(0, 200)}`);

            // Model not supported for this key -> skip model entirely
            if (statusCode === 404 || /not found/i.test(msg)) {
              console.warn(`[GeminiService] Model ${modelName} not available for this key, skipping.`);
              break; // go to next model
            }

            // Quota exceeded: do NOT retry same model many times; move to next model
            if (statusCode === 429 || /quota/i.test(msg) || /quota exceeded/i.test(msg)) {
              console.warn(`[GeminiService] Quota exceeded for model ${modelName}, moving to next model.`);
              break; // don't retry same model on 429
            }

            // Service unavailable: retry with backoff
            if ((statusCode === 503 || /unavailable/i.test(msg)) && attempt < maxAttempts) {
              const backoff = Math.pow(2, attempt) * 1000;
              console.warn(`[GeminiService] Service unavailable. Backoff ${backoff}ms and retrying...`);
              await sleep(backoff);
              continue;
            }

            // API key / permissions errors -> stop completely (don't count towards circuit breaker)
            if (/API key/i.test(msg) || /permission/i.test(msg) || /denied/i.test(msg) || /invalid/i.test(msg)) {
              throw new Error(`API key error: ${msg}`);
            }
            
            // Record failure for transient errors (will trigger circuit breaker if too many)
            recordFailure();

            // For timeout/other errors -> try next model
            console.warn(`[GeminiService] Moving to next model after error.`);
            break;
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          }
      } // end attempts for model
    } // end models loop

    // Record failure if we exhausted all models without success
    if (lastError) {
      recordFailure();
    }
    
    throw lastError || new Error("Не удалось получить ответ от Gemini. Попробуйте позже.");
  }

  // --------- Other providers (OpenRouter/OpenAI/Grok/Groq) ----------
  if (isOpenRouter || isGrok || isGroq || isOpenAI) {
    const provider = isOpenRouter ? "OpenRouter" : (isGrok ? "Grok" : (isGroq ? "Groq" : "OpenAI"));
    console.log(`[GeminiService] Using ${provider} API`);

    let endpoint = "";
    let model = "";

    if (isOpenRouter) {
      endpoint = "https://openrouter.ai/api/v1/chat/completions";
      model = "google/gemini-2.0-flash-001";
    } else if (isGrok) {
      endpoint = "https://api.x.ai/v1/chat/completions";
      model = "grok-beta";
    } else if (isGroq) {
      endpoint = "https://api.groq.com/openai/v1/chat/completions";
      model = "llama-3.3-70b-versatile";
    } else {
      endpoint = "https://api.openai.com/v1/chat/completions";
      model = "gpt-4o-mini";
    }

    try {
      const res = await axios.post(endpoint, {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      }, {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      });

      if (res.data?.choices?.[0]?.message?.content) return res.data.choices[0].message.content;
      throw new Error("Некорректный ответ от провайдера: " + JSON.stringify(res.data));
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error?.message || err?.message || JSON.stringify(err);
      console.error(`[GeminiService] ${provider} Error:`, status, msg);
      throw new Error(`${provider} Error: ${msg}`);
    }
  }

  // This point should never be reached due to validation above
  // Removed fallback for unknown key formats to prevent invalid requests
  throw new Error("Неверный формат API ключа. Поддерживаются: Google Gemini (AIza...), OpenRouter (sk-or-...), Grok (xai-...), Groq (gsk_...), OpenAI (sk-proj-...).");
}