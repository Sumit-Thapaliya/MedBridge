const BaseProvider = require("./BaseProvider");

class GeminiProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.model = config.model || process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-1.5-flash";
    this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }

  validateConfig() {
    if (!this.apiKey) {
      return { valid: false, error: "GEMINI_API_KEY not configured" };
    }
    return { valid: true };
  }

  // Convert OpenAI style messages to Gemini format
  toGeminiFormat(systemPrompt, messages) {
    const contents = [];
    let systemInstruction = systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined;

    for (const m of messages) {
      if (m.role === "system") {
        // Append system to instruction
        systemInstruction = { parts: [{ text: (systemInstruction?.parts?.[0]?.text || "") + "\n" + m.content }] };
        continue;
      }
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }

    return { systemInstruction, contents };
  }

  async chat({ systemPrompt, messages }, options = {}) {
    if (!this.validateConfig().valid) throw new Error("GEMINI_API_KEY not configured");

    const { systemInstruction, contents } = this.toGeminiFormat(systemPrompt, messages);
    const truncated = contents.slice(-20);

    const body = {
      system_instruction: systemInstruction,
      contents: truncated,
      generationConfig: {
        temperature: (options.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || "0.7")) || 0.7,
        maxOutputTokens: (options.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS || "2048")) || 2048,
      },
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${txt}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return {
      content: text,
      tokens: {
        prompt: data.usageMetadata?.promptTokenCount,
        completion: data.usageMetadata?.candidatesTokenCount,
        total: data.usageMetadata?.totalTokenCount,
      },
      model: this.model,
      raw: data,
    };
  }
}

module.exports = GeminiProvider;
