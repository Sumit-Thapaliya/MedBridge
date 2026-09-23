const BaseProvider = require("./BaseProvider");

/**
 * OpenRouterProvider - Unified gateway that supports OpenAI, Claude, Gemini, etc via single API
 * Recommended for production as it allows switching models without changing code
 * Docs: https://openrouter.ai/docs
 */
class OpenRouterProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = config.model || process.env.OPENROUTER_MODEL || process.env.LLM_MODEL || "openai/gpt-4o-mini";
    this.baseUrl = config.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    this.appName = config.appName || "MedBridge";
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: "OPENROUTER_API_KEY not configured" };
    return { valid: true };
  }

  async chat({ systemPrompt, messages }, options = {}) {
    const check = this.validateConfig();
    if (!check.valid) throw new Error(check.error);

    const allMessages = this.buildMessages(systemPrompt, messages);

    const body = {
      model: this.model,
      messages: this.truncateMessages(allMessages, 25),
      temperature: (options.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || "0.7")) || 0.7,
      max_tokens: (options.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS || "2048")) || 2048,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": process.env.CLIENT_ORIGIN || "http://localhost:5173",
        "X-Title": this.appName,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || "",
      tokens: {
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
      model: data.model || this.model,
      raw: data,
    };
  }

  async *chatStream({ systemPrompt, messages }, options = {}) {
    const check = this.validateConfig();
    if (!check.valid) throw new Error(check.error);

    const allMessages = this.buildMessages(systemPrompt, messages);

    const body = {
      model: this.model,
      messages: this.truncateMessages(allMessages, 25),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": process.env.CLIENT_ORIGIN || "http://localhost:5173",
        "X-Title": this.appName,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${txt}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {}
        }
      }
    }
  }
}

module.exports = OpenRouterProvider;
