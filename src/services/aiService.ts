import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
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
        const delay = this.config.retryDelay * Math.pow(1.5, cycle - 1);
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000)));
      }
 
      for (const provider of ordered) {
        const apiKey = keys[provider];
        if (!apiKey) {
          if (cycle === 1) lastErrors.push(`${provider}: no API key configured`);
          continue;
        }
 
        try {
          console.log(`[AI] Provider: ${provider}, Text length: ${text.length}, Attempt: ${cycle}`);
          
          const result = await Promise.race([
            this.callProvider(provider, apiKey, text, logCallback),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('AI request timeout')), this.config.timeout)
            )
          ]);
          
          if (result && result.trim()) {
            logCallback(`✅ AI processing succeeded using provider: ${provider}`);
            return result.trim();
          }
          throw new Error("Provider returned an empty response");
        } catch (err: any) {
          const msg = err.message || String(err);
          errorTracker.track(err, `AIService.processText.${provider}.cycle${cycle}`);
          
          if (msg.includes('timeout')) {
            logCallback(`⏱️ AI Provider ${provider} timeout (slow connection)`);
          } else if (msg.includes('429') || msg.includes('quota')) {
            logCallback(`🚫 AI Provider ${provider} quota exceeded`);
          } else if (msg.includes('network') || msg.includes('ECONNREFUSED')) {
            logCallback(`🌐 AI Provider ${provider} network error`);
          } else {
            logCallback(`❌ AI Provider ${provider} error: ${msg}`);
          }
          
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
    const modelId = "gemini-2.0-flash";
    logCallback(`📡 Google Gemini (${modelId})...`);
    
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: modelId,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      if (!text || !text.trim()) {
        throw new Error("Gemini returned empty response");
      }
      
      return text;
    } catch (e: any) {
      console.error("[AI Gemini] Fatal error:", e);
      throw e;
    }
  }
 
  private async callGitHub(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 GitHub Models (gpt-4o)...`);
    const url = "https://models.inference.ai.azure.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { 
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 4000
      }
    });
 
    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || `GitHub AI error ${response.status}`;
      throw new Error(errorMsg);
    }
    
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      throw new Error("GitHub returned empty response");
    }
    
    return content;
  }
 
  private async callOpenRouter(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 OpenRouter (gpt-4o-mini)...`);
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { 
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      }
    });
 
    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || `OpenRouter error ${response.status}`;
      throw new Error(errorMsg);
    }
    
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      throw new Error("OpenRouter returned empty response");
    }
    
    return content;
  }
 
  private async callDeepSeek(apiKey: string, prompt: string, logCallback: (msg: string) => void): Promise<string> {
    logCallback(`📡 DeepSeek (deepseek-chat)...`);
    const url = "https://api.deepseek.com/chat/completions";
    const response = await universalFetch(url, {
      method: 'POST',
      headers: { 
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      }
    });
 
    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || `DeepSeek error ${response.status}`;
      throw new Error(errorMsg);
    }
    
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      throw new Error("DeepSeek returned empty response");
    }
    
    return content;
  }
}
