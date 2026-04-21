import { universalFetch } from "./http";
import { errorTracker } from "../utils/errorTracker";
import { AIProcessingError } from "../utils/errors";
import { DEFAULT_AI_PROMPT } from "../constants/prompts";
 
export interface AIServiceConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number; 
}
 
export class AIService {
  private config: AIServiceConfig;
 
  constructor(config: AIServiceConfig = { 
    maxRetries: 5,
    retryDelay: 3000,
    timeout: 120000
  }) {
    this.config = config;
  }
 
  async processText(
    text: string,
    keys: Record<string, string>,
    preferredProvider: string = 'github',
    logCallback: (msg: string) => void = () => {},
    signal?: AbortSignal
  ): Promise<{ success: true; result: string; provider: string } | { success: false; error: string; provider: string }> {
    const providers = ["gemini", "github", "openrouter", "deepseek"];
    const effective = preferredProvider && providers.includes(preferredProvider) ? preferredProvider : "gemini";
    const ordered = [effective, ...providers.filter(p => p !== effective)];
    let lastError: string | null = null;
    let lastProvider = "unknown";

    for (let cycle = 1; cycle <= this.config.maxRetries; cycle++) {
      if (cycle > 1) {
        logCallback(`🔄 AI retry ${cycle}/${this.config.maxRetries}...`);
        const delay = this.config.retryDelay * Math.pow(1.5, cycle - 1);
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000)));
      }

      for (const provider of ordered) {
        lastProvider = provider;
        const apiKey = keys[provider];
        if (!apiKey) continue;

        try {
          console.log(`[AI] Provider: ${provider}, Text length: ${text.length}, Attempt: ${cycle}`);
          
          const result = await this.callProvider(provider, apiKey, text, logCallback, signal);
          
          if (result && result.trim()) {
            logCallback(`✅ AI processing succeeded using provider: ${provider}`);
            return { success: true, result: result.trim(), provider };
          }
          throw new Error("Provider returned an empty response");
        } catch (err: any) {
          if (err.name === 'AbortError') throw err; // propagate cancellation
          const msg = err.message || String(err);
          errorTracker.track(err, `AIService.processText.${provider}.cycle${cycle}`);
          
          if (msg.includes('timeout')) {
            logCallback(`⏱️ AI Provider ${provider} timeout`);
          } else {
            logCallback(`❌ AI Provider ${provider} error: ${msg}`);
          }
          lastError = msg;
        }
      }
    }

    return { success: false, error: lastError || "Все AI провайдеры не сработали", provider: lastProvider };
  }

  private async callProvider(
    provider: string,
    apiKey: string,
    text: string,
    logCallback: (msg: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const prompt = `${DEFAULT_AI_PROMPT}

ТЕКСТ ДЛЯ ОБРАБОТКИ:
${text}`;

    switch (provider) {
      case 'gemini':
        return this.callGemini(apiKey, prompt, logCallback, signal);
      case 'github':
        return this.callGitHub(apiKey, prompt, logCallback, signal);
      case 'openrouter':
        return this.callOpenRouter(apiKey, prompt, logCallback, signal);
      case 'deepseek':
        return this.callDeepSeek(apiKey, prompt, logCallback, signal);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async callGitHub(apiKey: string, prompt: string, logCallback: (msg: string) => void, signal?: AbortSignal): Promise<string> {
    logCallback(`📡 GitHub Models (gpt-4o)...`);
    const url = "https://models.inference.ai.azure.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { "Authorization": `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
      body: { model: "gpt-4o", messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 4000 },
      skipRetry: true,
      timeout: 120000,
      signal
    });

    if (!response.ok) {
      let errorMsg = `GitHub AI error ${response.status}`;
      try {
        const data = await response.json();
        errorMsg = data.error?.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error("GitHub returned empty response");
    
    return content;
  }

  private async callOpenRouter(apiKey: string, prompt: string, logCallback: (msg: string) => void, signal?: AbortSignal): Promise<string> {
    const models = ["google/gemini-2.0-flash-001", "google/gemini-flash-1.5", "anthropic/claude-3-haiku", "openai/gpt-3.5-turbo"];
    logCallback(`📡 OpenRouter start (primary: ${models[0]})...`);
    
    let lastError = "";
    for (const modelId of models) {
      try {
        logCallback(`📡 OpenRouter trying model: ${modelId}...`);
        const url = "https://openrouter.ai/api/v1/chat/completions";
        const response = await universalFetch(url, {
          method: 'POST',
          headers: { 
            "Authorization": `Bearer ${apiKey.trim()}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://newsbot.manager",
            "X-Title": "TG Bot Manager"
          },
          body: {
            model: modelId,
            messages: [{ role: "user", content: prompt }]
          },
          skipRetry: true,
          timeout: 45000,
          signal
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error?.message || `Status ${response.status}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        if (content.trim()) return content;
      } catch (err: any) {
        lastError = err.message;
        logCallback(`⚠️ Model ${modelId} failed: ${lastError}`);
        if (signal?.aborted) throw err;
      }
    }
    
    throw new Error(`OpenRouter failed all models. Last error: ${lastError}`);
  }

  private async callDeepSeek(apiKey: string, prompt: string, logCallback: (msg: string) => void, signal?: AbortSignal): Promise<string> {
    logCallback(`📡 DeepSeek (deepseek-chat)...`);
    const url = "https://api.deepseek.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { 
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      },
      skipRetry: true,
      timeout: 120000,
      signal
    });

    if (!response.ok) {
      let errorMsg = `DeepSeek error ${response.status}`;
      try {
        const data = await response.json();
        errorMsg = data.error?.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error("DeepSeek returned empty response");
    
    return content;
  }

  private async callGemini(apiKey: string, prompt: string, logCallback: (msg: string) => void, signal?: AbortSignal): Promise<string> {
    const modelId = "gemini-2.0-flash";
    logCallback(`📡 Gemini (${modelId})...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey.trim()}`;

    const response = await universalFetch(url, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
      },
      skipRetry: true,
      timeout: 60000,
      signal
    });

    const data = await response.json();
    
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Prompt blocked: ${data.promptFeedback.blockReason}`);
    }
    
    if (!data.candidates?.length) {
      if (data.error?.message) throw new Error(data.error.message);
      throw new Error("Gemini returned no candidates");
    }

    const candidate = data.candidates[0];
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
       throw new Error(`Gemini blocked: ${candidate.finishReason}`);
    }

    const content = candidate.content?.parts?.[0]?.text || "";
    if (!content.trim()) throw new Error("Gemini returned empty response");
    
    return content;
  }
}
