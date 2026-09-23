const BaseProvider = require("./BaseProvider");

// Groq uses OpenAI-compatible API
class GroqProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey || process.env.GROQ_API_KEY;
    this.model = config.model || process.env.GROQ_MODEL || process.env.LLM_MODEL || "llama-3.1-70b-versatile";
    this.baseUrl = "https://api.groq.com/openai/v1";
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: "GROQ_API_KEY not configured" };
    return { valid: true };
  }

  async chat({ systemPrompt, messages }, options = {}) {
    if (!this.validateConfig().valid) throw new Error("GROQ_API_KEY not configured");

    const allMessages = this.buildMessages(systemPrompt, messages);

    const body = {
      model: this.model,
      messages: this.truncateMessages(allMessages, 20),
      temperature: (options.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || "0.7")) || 0.7,
      max_tokens: (options.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS || "2048")) || 2048,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || "",
      tokens: {
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      },
      model: data.model,
      raw: data,
    };
  }
}

module.exports = GroqProvider;
