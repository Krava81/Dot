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

  // Detect provider
  const cleanKey = apiKey.trim();
  const isGemini = cleanKey.startsWith('AIza');
  const isOpenRouter = cleanKey.startsWith('sk-or-');
  const isGrok = cleanKey.startsWith('xai-');
  const isGroq = cleanKey.startsWith('gsk_');

  console.log(`Provider Detection: Gemini=${isGemini}, OpenRouter=${isOpenRouter}, Grok=${isGrok}, Groq=${isGroq}`);

  const prompt = `Translate the following news article to Russian and adapt it for a Telegram channel. 
  Make it engaging, concise, use emojis, and format it using basic HTML tags (<b>, <i>, <a>).
  
  CRITICAL INSTRUCTIONS:
  1. All brand names, technical names, and car brand names MUST remain in English.
  2. The rest of the text must be in Russian.
  3. EXCLUDE any links to the source article or external websites from the generated text.
  4. Do not use any other formatting. Ensure all tags are properly closed.
  
  Title: ${title}
  Content: ${text}`;

  if (isGemini) {
    console.log("Using Google Gemini API");
    const ai = new GoogleGenAI({ apiKey: cleanKey });
    
    // Try primary model, fallback to stable models if it fails
    const models = ["gemini-1.5-flash", "gemini-2.0-flash-exp", "gemini-3-flash-preview"];
    
    let lastError = null;
    for (const modelName of models) {
      try {
        console.log(`Trying Gemini model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt
        });
        if (response && response.text) return response.text;
        throw new Error("Empty response from Gemini");
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} failed:`, err.message);
        if (err.message?.includes("API key not valid")) throw err;
        continue;
      }
    }
    throw lastError || new Error("Не удалось получить ответ от Gemini.");
  } 
  
  if (isOpenRouter || isGrok || isGroq) {
    const provider = isOpenRouter ? "OpenRouter" : (isGrok ? "Grok" : "Groq");
    console.log(`Using ${provider} API`);
    
    const endpoint = isOpenRouter 
      ? "https://openrouter.ai/api/v1/chat/completions" 
      : (isGrok ? "https://api.x.ai/v1/chat/completions" : "https://api.groq.com/openai/v1/chat/completions");
    
    const model = isOpenRouter 
      ? "google/gemini-2.0-flash-exp:free" 
      : (isGrok ? "grok-beta" : "llama-3.3-70b-versatile");

    try {
      console.log(`Sending request to ${provider} (${endpoint}) with model ${model}`);
      const response = await axios.post(endpoint, {
        model: model,
        messages: [{ role: "user", content: prompt }]
      }, {
        headers: {
          "Authorization": `Bearer ${cleanKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/capacitor-community/http",
          "X-Title": "Telegram News Bot"
        },
        timeout: 15000
      });
      
      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }
      throw new Error("Некорректный ответ от API");
    } catch (err: any) {
      console.error(`${provider} Error Details:`, err.response?.data || err.message);
      const errMsg = err.response?.data?.error?.message || err.message;
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
