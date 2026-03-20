import { GoogleGenAI } from "@google/genai";

export async function processNewsText(title: string, text: string, manualApiKey?: string) {
  // Priority: Manual Key > Env API_KEY > Env GEMINI_API_KEY
  const apiKey = manualApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
  
  if (!apiKey) {
    throw new Error("API key is missing. Please select an API key in the settings or via the manager.");
  }

  // Create instance right before use to get the latest key
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Translate the following news article to Russian and adapt it for a Telegram channel. 
      Make it engaging, concise, use emojis, and format it using basic HTML tags (<b>, <i>, <a>).
      
      CRITICAL INSTRUCTIONS:
      1. All brand names, technical names, and car brand names MUST remain in English.
      2. The rest of the text must be in Russian.
      3. EXCLUDE any links to the source article or external websites from the generated text.
      4. Do not use any other formatting. Ensure all tags are properly closed.
      
      Title: ${title}
      Content: ${text}`
    });
    return response.text;
  } catch (err) {
    console.error("Gemini Text Error:", err);
    throw err;
  }
}
