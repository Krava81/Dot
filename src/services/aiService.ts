import { GoogleGenAI } from "@google/genai";
import { universalFetch } from "./http";
import { errorTracker } from "../utils/errorTracker";
import { AIProcessingError } from "../utils/errors";
import { DEFAULT_AI_PROMPT } from "../constants/prompts";

export interface AIServiceConfig {
  maxRetries: number;
  retryDelay: number;
}

export class AIService {
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig = { maxRetries: 3, retryDelay: 2000 }) {
    this.config = config;
  }

  async processText(
    text: string,
    keys: Record<string, string>,
    preferredProvider: string = 'gemini',
    logCallback: (msg: string) => void = () => {}
  ): Promise<string> {
    const providers = ["gemini", "github", "openrouter", "deepseek"];
    const effective = preferredProvider || "gemini";
    const ordered = [effective, ...providers.filter(p => p !== effective)];
    const lastErrors: string[] = [];

    for (let cycle = 1; cycle <= this.config.maxRetries; cycle++) {
      if (cycle > 1) {
        logCallback(`🔄 AI retry ${cycle}/${this.config.maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }

      for (const provider of ordered) {
        const apiKey = keys[provider];
        if (!apiKey) {
          if (cycle === 1) lastErrors.push(`${provider}: no API key configured`);
          continue;
        }

        try {
          console.log(`[AI] Provider: ${provider}, Text length: ${text.length}`);
          const result = await this.callProvider(provider, apiKey, text, logCallback);
          if (result && result.trim()) {
            logCallback(`✅ AI processing succeeded using provider: ${provider}`);
            return result.trim();
          }
          throw new Error("Provider returned an empty response");
        } catch (err: any) {
          const msg = err.message || String(err);
          errorTracker.track(err, `AIService.processText.${provider}.cycle${cycle}`);
          logCallback(`❌ AI Provider ${provider} error: ${msg}`);
          lastErrors.push(`${provider}: ${msg}`);
        }
      }
    }

    throw new AIProcessingError("Все AI провайдеры не сработали", lastErrors);
  }

  private async callProvider(
    provider: string,
    apiKey: string,
    text: string,
    logCallback: (msg: string) => void
  ): Promise<string> {
    const prompt = `${DEFAULT_AI_PROMPT}

ТЕКСТ ДЛЯ ОБРАБОТКИ:
${text}`;

    switch (provider) {
      case 'gemini':
        return this.callGemini(apiKey, prompt, logCallback);
      case 'github':
        return this.callGitHub(apiKey, prompt, logCallback);
      case 'openrouter':
        return this.callOpenRouter(apiKey, prompt, logCallback);
      case 'deepseek':
        return this.callDeepSeek(apiKey, prompt, logCallback);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async callGemini(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 Google Gemini (gemini-2.0-flash)...`);
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash", // Using a standard stable model
      contents: [{ parts: [{ text: prompt }] }],
    });
    
    if (!response.text) {
      throw new Error("Gemini returned no text content");
    }
    return response.text;
  }

  private async callGitHub(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 GitHub Models (gpt-4o-mini)...`);
    const url = "https://models.inference.ai.azure.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 4000
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `GitHub AI error ${response.status}`);
    return data.choices?.[0]?.message?.content || "";
  }

  private async callOpenRouter(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 OpenRouter (gpt-4o-mini)...`);
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `OpenRouter error ${response.status}`);
    return data.choices?.[0]?.message?.content || "";
  }

  private async callDeepSeek(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 DeepSeek (deepseek-chat)...`);
    const url = "https://api.deepseek.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `DeepSeek error ${response.status}`);
    return data.choices?.[0]?.message?.content || "";
  }
}
