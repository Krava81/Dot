import { GoogleGenAI } from "@google/genai";
import axios from "axios";

export async function processNewsText(title: string, text: string, manualApiKey?: string) {
  const resolveKey = () => {
    if (manualApiKey && manualApiKey.trim().length > 10) return manualApiKey.trim();
    const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    // Игнорируем заполнители платформы, принимаем только ключи, начинающиеся с AIza
    if (envKey && envKey.startsWith('AIza') && envKey.trim().length > 10) {
      return envKey.trim();
    }
    return "";
  };

  const apiKey = resolveKey();
  
  if (!apiKey) {
    throw new Error("API ключ не найден. Введите ключ в настройках.");
  }

  // Detect provider
  const cleanKey = apiKey.trim();
  const isGemini = cleanKey.startsWith('AIza');
  const isOpenRouter = cleanKey.startsWith('sk-or-');
  const isGrok = cleanKey.startsWith('xai-');
  const isGroq = cleanKey.startsWith('gsk_');
  const isOpenAI = cleanKey.startsWith('sk-proj-') || (cleanKey.startsWith('sk-') && !isOpenRouter);

  console.log(`Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}, OpenAI=${isOpenAI}`);

  const prompt = `Translate the following news article to Russian and adapt it for a Telegram channel. 
  Make it engaging, readable, and concise. Use emojis.
  
  CRITICAL INSTRUCTIONS:
  1. DO NOT use any HTML tags (like <b>, <i>, <a>, etc.) or any other technical symbols and artifacts. The output must be pure plain text.
  2. IF THE INPUT TEXT LOOKS LIKE CSS, JAVASCRIPT, OR TECHNICAL CODE, IGNORE IT AND REPLY WITH "Ошибка: присланный текст не является новостью."
  3. Divide the text into clear paragraphs based on topics/themes.
  4. All brand names, technical names, and car brand names MUST remain in English (e.g., BMW, Turbocharger, etc.).
  5. The rest of the text must be in Russian.
  6. EXCLUDE any links to the source article or external websites from the generated text.
  7. At the end of the post, add relevant hashtags related to cars and the specific topic of the news.
  
  Title: ${title}
  Content: ${text}`;

  if (isGemini) {
    console.log("Using Google Gemini API");
    if (!cleanKey.startsWith('AIza')) {
      throw new Error("Неверный формат ключа Gemini. Ключ должен начинаться с AIza.");
    }
    const ai = new GoogleGenAI({ apiKey: cleanKey });
    
    // Try primary model, fallback to stable models if it fails
    // v5.0: Prioritize flash for speed, and add timeout
    const models = ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-1.5-flash"];
    
    let lastError = null;
    for (const modelName of models) {
      try {
        console.log(`[GeminiService] Trying model: ${modelName}`);
        
        // v5.0: Add 60s timeout for Gemini (increased from 30s)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Gemini timeout (${modelName})`)), 60000)
        );
        
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: prompt
          }),
          timeoutPromise
        ]) as any;

        if (response && response.text) {
          console.log(`[GeminiService] Success with model: ${modelName}`);
          return response.text;
        }
        throw new Error(`Empty response from Gemini (${modelName})`);
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Model ${modelName} failed:`, err.message);
        if (err.message?.includes("API key not valid")) throw err;
        // If it's a timeout or other error, try the next model
        continue;
      }
    }
    throw lastError || new Error("Не удалось получить ответ от Gemini.");
  } 
  
  if (isOpenRouter || isGrok || isGroq || isOpenAI) {
    const provider = isOpenRouter ? "OpenRouter" : (isGrok ? "Grok" : (isGroq ? "Groq" : "OpenAI"));
    console.log(`Using ${provider} API`);
    
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
    } else if (isOpenAI) {
      endpoint = "https://api.openai.com/v1/chat/completions";
      model = "gpt-4o-mini";
    }

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
          "HTTP-Referer": "https://github.com/capacitor-community/http",
          "X-Title": "Telegram News Bot"
        },
        timeout: 20000
      });
      
      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }
      throw new Error("Некорректный ответ от API: " + JSON.stringify(response.data));
    } catch (err: any) {
      console.error(`${provider} Error Details:`, err.response?.data || err.message);
      const errMsg = err.response?.data?.error?.message || err.response?.data?.error || err.message;
      throw new Error(`${provider} Error: ${errMsg}`);
    }
  }

  // If it doesn't match any known prefix but looks like a key, try Gemini as default
  if (apiKey.length > 20) {
    console.log("Unknown key format, defaulting to Gemini...");
    const ai = new GoogleGenAI({ apiKey });
    try {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt
      });
      return response.text;
    } catch (e) {
      throw new Error("Неверный формат ключа. Поддерживаются Gemini (AIza...), OpenRouter (sk-or-...) и Grok (xai-...).");
    }
  }

  throw new Error("Неверный формат API ключа.");
}
