import { GoogleGenAI } from "@google/genai";
import axios from "axios";

export async function processNewsText(title: string, text: string, manualApiKey?: string) {
  const resolveKey = () => {
    if (manualApiKey && manualApiKey.trim().length > 10) return manualApiKey.trim();
    const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== 'null' && envKey.trim().length > 10) {
      return envKey.trim();
    }
    return "";
  };

  const apiKey = resolveKey();
  
  if (!apiKey) {
    throw new Error("API ключ не найден. Введите ключ в настройках.");
  }

  const cleanKey = apiKey.trim();
  const isGemini = cleanKey.startsWith('AIza');
  const isOpenRouter = cleanKey.startsWith('sk-or-');
  const isGrok = cleanKey.startsWith('xai-');
  const isGroq = cleanKey.startsWith('gsk_');
  const isOpenAI = cleanKey.startsWith('sk-proj-') || (cleanKey.startsWith('sk-') && !isOpenRouter);
  const isNvidia = cleanKey.startsWith('nvapi-');

  console.log(`Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}, OpenAI=${isOpenAI}, Nvidia=${isNvidia}`);

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
    console.log("Using Google Gemini API with REST endpoint");
    
    // ✅ ИСПОЛЬЗУЕМ REST API НАПРЯМУЮ БЕЗ SDK (более надежно)
    const models = ["gemini-1.5-flash", "gemini-1.5-pro"];
    
    let lastError = null;
    for (let i = 0; i < models.length; i++) {
      const modelName = models[i];
      try {
        console.log(`[GeminiService] Trying model: ${modelName}. Prompt length: ${prompt.length}`);
        
        // Используем REST API Gemini
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${cleanKey}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 4096
            }
          },
          {
            headers: {
              "Content-Type": "application/json"
            },
            timeout: 60000
          }
        );

        if (response.status === 200 && response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = response.data.candidates[0].content.parts[0].text.trim();
          if (text.length > 0) {
            console.log(`[GeminiService] Success with model: ${modelName}. Response length: ${text.length}`);
            return text;
          }
        }
        throw new Error(`Empty response from Gemini (${modelName})`);
      } catch (err: any) {
        lastError = err;
        const errMsg = err.response?.data?.error?.message || err.message;
        console.warn(`[GeminiService] Model ${modelName} failed:`, errMsg);
        
        // Если ошибка в ключе - сразу выбрасываем
        if (err.response?.status === 400 && errMsg?.includes("API key")) {
          throw new Error("🚫 Gemini: Неверный или неактивный API ключ. Проверьте ключ на console.cloud.google.com");
        }
        
        if (err.response?.status === 403) {
          throw new Error("🚫 Gemini: Ключ не имеет доступа к Gemini API. Включите API в Cloud Console.");
        }
        
        if (err.response?.status === 429) {
          throw new Error("🚫 Gemini: Лимит запросов исчерпан. Подождите или используйте другой ключ.");
        }
        
        // Пробуем следующую модель
        continue;
      }
    }
    throw lastError || new Error("❌ Gemini: Не удалось получить ответ от Gemini.");
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

    console.log(`Using ${provider} API`);
    try {
      console.log(`Sending request to ${provider} (${endpoint}) with model ${model}`);
      const response = await axios.post(endpoint, {
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      }, {
        headers: {
          "Authorization": `Bearer ${cleanKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Krava81/Dot",
          "X-Title": "Telegram News Bot"
        },
        timeout: 30000
      });
      
      if (response.data?.choices?.[0]?.message?.content) {
        const content = response.data.choices[0].message.content;
        if (content && content.trim().length > 0) {
          return content;
        }
      }
      throw new Error("Пустой ответ от " + provider);
    } catch (err: any) {
      console.error(`${provider} Error Details:`, err.response?.data || err.message);
      
      let errMsg = "";
      
      if (err.response?.status === 429) {
        errMsg = `${provider}: 🚫 Лимит запросов и��черпан (rate limit). Используйте другой ключ или подождите.`;
      } else if (err.response?.status === 400) {
        const errorData = err.response?.data?.error?.message || String(err.response?.data);
        if (errorData.includes('quota') || errorData.includes('limit') || errorData.includes('exceeded')) {
          errMsg = `${provider}: 🚫 Квота исчерпана. ${errorData}`;
        } else {
          errMsg = `${provider}: Ошибка запроса. ${errorData}`;
        }
      } else if (err.response?.status === 401 || err.response?.status === 403) {
        errMsg = `${provider}: 🚫 Неверный или истекший API ключ (${err.response?.status})`;
      } else if (err.code === 'ECONNABORTED') {
        errMsg = `${provider}: ⏱️ Превышено время ожидания (timeout)`;
      } else if (err.message?.includes('Network Error')) {
        errMsg = `${provider}: 🌐 Сетевая ошибка. Проверьте интернет-соединение.`;
      } else {
        errMsg = `${provider}: ${err.response?.data?.error?.message || err.message}`;
      }
      
      throw new Error(errMsg);
    }
  }

  throw new Error("Неверный формат API ключа. Поддерживаются: Gemini (AIza...), OpenRouter (sk-or-...), Grok (xai-...), Groq (gsk_...), OpenAI (sk-proj-...), Nvidia (nvapi-...)");
}