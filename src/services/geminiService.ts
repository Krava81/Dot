import { GoogleGenAI } from "@google/genai";
import axios from "axios";

export interface ApiKeyStatus {
  isValid: boolean;
  message: string;
  isRateLimited?: boolean;
}

export async function processNewsText(title: string, text: string, manualApiKey?: string): Promise<string> {
  const resolveKey = (): string | null => {
    if (manualApiKey && typeof manualApiKey === 'string') {
      const trimmed = manualApiKey.trim();
      if (trimmed.length > 10) return trimmed;
    }
    
    const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (envKey && typeof envKey === 'string' && envKey !== 'undefined' && envKey !== 'null') {
      const trimmed = envKey.trim();
      if (trimmed.length > 10) return trimmed;
    }
    
    return null;
  };

  const apiKey = resolveKey();
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error("API ключ не найден или некорректен. Введите ключ в настройках.");
  }

  const cleanKey = String(apiKey).trim();
  if (cleanKey.length < 10) {
    throw new Error("API ключ слишком короткий. Минимальная длина 10 символов.");
  }

  const isGemini = cleanKey.startsWith('AIza');
  const isOpenRouter = cleanKey.startsWith('sk-or-');
  const isGrok = cleanKey.startsWith('xai-');
  const isGroq = cleanKey.startsWith('gsk_');
  const isOpenAI = cleanKey.startsWith('sk-proj-') || (cleanKey.startsWith('sk-') && !isOpenRouter);
  const isNvidia = cleanKey.startsWith('nvapi-');

  console.log(`[ProcessNewsText] Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}, OpenAI=${isOpenAI}, Nvidia=${isNvidia}`);

  if (!isGemini && !isOpenRouter && !isGrok && !isGroq && !isOpenAI && !isNvidia) {
    throw new Error(`Неизвестный формат ключа: "${cleanKey.substring(0, 10)}...". Поддерживаются: Gemini (AIza...), OpenRouter (sk-or-...), Grok (xai-...), Groq (gsk_...), OpenAI (sk-proj-...), Nvidia (nvapi-...)`);
  }

  const prompt = `Translate the following news article to Russian and adapt it for a Telegram channel. 
Make it engaging, readable, and concise. Use emojis.

CRITICAL INSTRUCTIONS:
1. DO NOT use any HTML tags (like <b>, <i>, <a>, etc.) or any other technical symbols and artifacts. The output must be pure plain text.
2. Divide the text into clear paragraphs based on topics/themes.
3. All brand names, technical names, and car brand names MUST remain in English (e.g., BMW, Turbocharger, etc.).
4. The rest of the text must be in Russian.
5. EXCLUDE any links to the source article or external websites from the generated text.
6. At the end of the post, add relevant hashtags related to cars and the specific topic of the news.

Title: ${title}
Content: ${text}`;

  if (isGemini) {
    console.log("[ProcessNewsText] Using Google Gemini API");
    const ai = new GoogleGenAI({ apiKey: cleanKey });
    const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    
    let lastError: Error | null = null;
    for (let i = 0; i < models.length; i++) {
      const modelName = models[i];
      try {
        console.log(`[GeminiService] Trying model: ${modelName}. Prompt length: ${prompt.length}`);
        const currentTimeout = i === 0 ? 120000 : 150000;
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Gemini timeout (${modelName}) after ${currentTimeout/1000}s`)), currentTimeout)
        );
        
        const response = await Promise.race([
          ai.models.generateContent(modelName, { 
            contents: [{ role: "user", parts: [{ text: prompt }] }] 
          }),
          timeoutPromise
        ]) as any;

        if (response && typeof response === 'object' && response.text && typeof response.text === 'string') {
          const responseText = String(response.text).trim();
          if (responseText.length > 0) {
            console.log(`[GeminiService] Success with model: ${modelName}. Response length: ${responseText.length}`);
            return responseText;
          }
        }
        throw new Error(`Empty or invalid response from Gemini (${modelName})`);
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Model ${modelName} failed:`, err.message);
        
        const message = String(err?.message || err || '');
        if (message.includes("API key not valid") || message.includes("401") || message.includes("403") || message.includes("PERMISSION_DENIED")) {
          throw err;
        }
        continue;
      }
    }
    throw lastError || new Error("Не удалось получить ответ от Gemini после всех попыток.");
  }
  
  if (isOpenRouter || isGrok || isGroq || isOpenAI || isNvidia) {
    let provider = "";
    let endpoint = "";
    let model = "";
    
    if (isOpenRouter) {
      provider = "OpenRouter";
      endpoint = "https://openrouter.ai/api/v1/chat/completions";
      model = "google/gemini-2.0-flash-001";
    } else if (isGrok) {
      provider = "Grok";
      endpoint = "https://api.x.ai/v1/chat/completions";
      model = "grok-beta";
    } else if (isGroq) {
      provider = "Groq";
      endpoint = "https://api.groq.com/openai/v1/chat/completions";
      model = "llama-3.3-70b-versatile";
    } else if (isOpenAI) {
      provider = "OpenAI";
      endpoint = "https://api.openai.com/v1/chat/completions";
      model = "gpt-4o-mini";
    } else if (isNvidia) {
      provider = "Nvidia";
      endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
      model = "nvidia/llama-3.1-nemotron-70b-instruct";
    }

    console.log(`[ProcessNewsText] Using ${provider} API with model ${model}`);
    try {
      console.log(`[ProcessNewsText] Sending request to ${provider} (${endpoint})`);
      const response = await axios.post(endpoint, {
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 4096
      }, {
        headers: {
          "Authorization": `Bearer ${cleanKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Krava81/Dot",
          "X-Title": "Telegram News Bot",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 120000,
        validateStatus: () => true // Принимаем все статусы
      });
      
      // Проверяем статус ответа
      if (response.status === 429) {
        throw new Error(`🚫 ${provider}: Лимит запросов исчерпан (rate limit). Попробуйте позже или используйте другой ключ.`);
      }
      
      if (response.status === 400) {
        const errorData = response.data?.error?.message || response.data?.message || JSON.stringify(response.data);
        if (String(errorData).includes('quota') || String(errorData).includes('limit') || String(errorData).includes('exceeded')) {
          throw new Error(`🚫 ${provider}: Квота/лимит исчерпана. ${errorData}`);
        }
        throw new Error(`❌ ${provider}: Неверный запрос. ${errorData}`);
      }
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(`🚫 ${provider}: Неверный, истекший или отозванный API ключ (статус ${response.status})`);
      }
      
      if (response.status !== 200) {
        const errorMsg = response.data?.error?.message || response.data?.message || `HTTP ${response.status}`;
        throw new Error(`❌ ${provider}: ${errorMsg}`);
      }

      // Проверяем данные ответа типо-безопасно
      if (!response.data || typeof response.data !== 'object') {
        throw new Error(`Некорректный ответ от ${provider}: не JSON`);
      }

      const data = response.data as any;
      if (!Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error(`Некорректный ответ от ${provider}: нет choices в ответе`);
      }

      const choice = data.choices[0];
      if (!choice || !choice.message || typeof choice.message !== 'object') {
        throw new Error(`Некорректный ответ от ${provider}: нет message в choice`);
      }

      const content = choice.message.content;
      if (!content || typeof content !== 'string') {
        throw new Error(`Некорректный ответ от ${provider}: content не строка`);
      }

      const trimmed = String(content).trim();
      if (trimmed.length === 0) {
        throw new Error(`${provider} вернул пустой ответ`);
      }

      return trimmed;
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      console.error(`[ProcessNewsText] ${provider} Error:`, errorMsg);
      
      // Уже обработано выше - пробрасываем как есть
      if (errorMsg.includes('🚫') || errorMsg.includes('❌')) {
        throw err;
      }

      // Обработка сетевых ошибок
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        throw new Error(`⏱️ ${provider}: Превышено время ожидания (timeout). Сервер не отвечает.`);
      }

      if (err.code === 'ENOTFOUND' || err.code === 'ENETUNREACH') {
        throw new Error(`🌐 ${provider}: Нет подключения к интернету или сервер недоступен.`);
      }

      throw new Error(`❌ ${provider} ошибка: ${errorMsg}`);
    }
  }

  throw new Error("Неверный формат API ключа. Поддерживаются: Gemini (AIza...), OpenRouter (sk-or-...), Grok (xai-...), Groq (gsk_...), OpenAI (sk-proj-...), Nvidia (nvapi-...)");
}