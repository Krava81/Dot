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

    const prompt = `Translate the following news article to Russian and adapt it for a Telegram channel. Make it engaging, readable, and concise. Use emojis. CRITICAL INSTRUCTIONS: 1. DO NOT use any HTML tags (like <b>, <i>, <a>, etc.) or any other technical symbols and artifacts. The output must be pure plain text. 2. Divide the text into clear paragraphs based on topics/themes. 3. All brand names, technical names, and car brand names MUST remain in English (e.g., BMW, Turbocharger, etc.). 4. The rest of the text must be in Russian. 5. EXCLUDE any links to the source article or external websites from the generated text. 6. At the end of the post, add relevant hashtags related to cars and the specific topic of the news. Title: ${title} Content: ${text}`;

    if (isGemini) {
        console.log("Using Google Gemini API");
        const ai = new GoogleGenAI({ apiKey: cleanKey });
        const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
        let lastError = null;
        for (let i = 0; i < models.length; i++) {
            const modelName = models[i];
            try {
                console.log(`[GeminiService] Trying model: ${modelName}. Prompt length: ${prompt.length}`);
                const currentTimeout = i === 0 ? 120000 : 150000;
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Gemini timeout (${modelName}) after ${currentTimeout/1000}s`)), currentTimeout));
                const response = await Promise.race([
                    ai.models.generateContent(modelName, { contents: [{ role: "user", parts: [{ text: prompt }] }] }),
                    timeoutPromise
                ]) as any;

                if (response && response.text && response.text.trim().length > 0) {
                    console.log(`[GeminiService] Success with model: ${modelName}. Response length: ${response.text.length}`);
                    return response.text;
                }
                throw new Error(`Empty or invalid response from Gemini (${modelName})`);
            } catch (err: any) {
                lastError = err;
                console.warn(`[GeminiService] Model ${modelName} failed:`, err.message);
                if (err.message?.includes("API key not valid") || err.message?.includes("401") || err.message?.includes("403")) throw err;
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

        console.log(`Using ${provider} API with model ${model}`);
        try {
            console.log(`Sending request to ${provider} (${endpoint})`);
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
                timeout: 120000
            });

            if (response.data?.choices?.[0]?.message?.content) {
                const content = response.data.choices[0].message.content;
                if (content && content.trim().length > 0) {
                    return content;
                }
                throw new Error(`${provider} вернул пустой ответ`);
            }
            throw new Error(`Некорректный ответ от ${provider}: ` + JSON.stringify(response.data));
        } catch (err: any) {
            console.error(`${provider} Error Details:`, err.response?.data || err.message);
            let errMsg = err.response?.data?.error?.message || err.response?.data?.error || err.message;
            if (err.code === 'ECONNABORTED') {
                errMsg = `${provider}: Превышено время ожидания (timeout)`;
            } else if (err.response?.status === 429) {
                errMsg = `${provider}: Превышен лимит запросов (rate limit). Попробуйте позже.`;
            } else if (err.response?.status === 401 || err.response?.status === 403) {
                errMsg = `${provider}: Неверный или истекший API ключ`;
            }
            throw new Error(`${provider} ошибка: ${errMsg}`);
        }
    }
    throw new Error("Неверный формат API ключа. Поддерживаются: Gemini (AIza...), OpenRouter (sk-or-...), Grok (xai-...), Groq (gsk_...), OpenAI (sk-proj-...), Nvidia (nvapi-...")
}