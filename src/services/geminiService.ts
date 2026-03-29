// name=src/services/geminiService.ts
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

export async function processNewsText(title: string, text: string, manualApiKey?: string) {
  const resolveKey = () => {
    // priority: manual > env (GEMINI_API_KEY) > env (API_KEY)
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
  const isGemini = cleanKey.startsWith("AIza");
  const isOpenRouter = cleanKey.startsWith("sk-or-");
  const isGrok = cleanKey.startsWith("xai-");
  const isGroq = cleanKey.startsWith("gsk_");
  const isOpenAI = cleanKey.startsWith("sk-proj-") || (cleanKey.startsWith("sk-") && !isOpenRouter);

  console.log(`Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}, OpenAI=${isOpenAI}`);

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

  // ----------------- Gemini branch -----------------
  if (isGemini) {
    console.log("[GeminiService] Using Google Gemini API");

    const ai = new GoogleGenAI({ apiKey: cleanKey });

    // Ordered list of models to try (use only models that exist for this key)
    const models = [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash-001",
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ];

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let lastError: any = null;

    for (const modelName of models) {
      let attempt = 0;
      const maxAttempts = 3; // initial try + 2 retries for quota/unavailable
      while (attempt < maxAttempts) {
        try {
          attempt++;
          console.log(`[GeminiService] Trying model: ${modelName} (attempt ${attempt}/${maxAttempts})`);

          const timeoutMs = 120000; // 120s
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini timeout (${modelName})`)), timeoutMs)
          );

          const response = (await Promise.race([
            ai.models.generateContent({
              model: modelName,
              contents: prompt
            }),
            timeoutPromise
          ])) as any;

          if (response && response.text && response.text.trim().length > 0) {
            console.log(`[GeminiService] Success with model: ${modelName}`);
            return response.text.trim();
          }
          throw new Error(`Empty response from Gemini (${modelName})`);
        } catch (err: any) {
          lastError = err;
          const statusCode = err?.response?.data?.error?.code || err?.code || err?.status || null;
          const msg = (err?.response?.data?.error?.message || err?.message || JSON.stringify(err)).toString();

          console.warn(`[GeminiService] Model ${modelName} failed`);
          console.warn(`  Status/Code: ${statusCode}`);
          console.warn(`  Message: ${msg.substring(0, 200)}`);

          // If model not found -> skip to next model
          if (statusCode === 404 || /not found/i.test(msg)) {
            console.warn(`[GeminiService] Model ${modelName} not available for this key, skipping.`);
            break; // go to next model in outer loop
          }

          // If rate limit or service unavailable -> retry with backoff
          if ((statusCode === 429 || statusCode === 503) && attempt < maxAttempts) {
            const backoff = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
            console.warn(`[GeminiService] Rate limit/service unavailable. Backoff ${backoff}ms and retrying...`);
            await sleep(backoff);
            continue;
          }

          // API key / permission errors -> stop entirely
          if (/API key/i.test(msg) || /permission/i.test(msg) || /denied/i.test(msg) || /invalid/i.test(msg)) {
            throw new Error(`API key error: ${msg}`);
          }

          // Timeout or other error -> try next model
          console.warn(`[GeminiService] Moving to next model after error.`);
          break;
        }
      }
    }

    throw lastError || new Error("Не удалось получить ответ от Gemini. Попробуйте позже.");
  }

  // ----------------- Other providers (OpenRouter / OpenAI / Grok / Groq) -----------------
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

  // fallback: try Gemini with safe model name
  if (apiKey.length > 20) {
    console.log("[GeminiService] Unknown key format, trying gemini-2.5-flash as fallback");
    const ai = new GoogleGenAI({ apiKey });
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });
      return response.text;
    } catch (e: any) {
      throw new Error("Неверный формат ключа или модель недоступна: " + (e?.message || JSON.stringify(e)));
    }
  }

  throw new Error("Неверный формат API ключа.");
}