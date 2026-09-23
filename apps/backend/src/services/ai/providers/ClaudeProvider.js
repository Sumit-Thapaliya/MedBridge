const BaseProvider = require("./BaseProvider");

class ClaudeProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.CLAUDE_MODEL || process.env.LLM_MODEL || "claude-3-haiku-20240307";
    this.baseUrl = "https://api.anthropic.com/v1";
  }

  validateConfig() {
    if (!this.apiKey) return { valid: false, error: "CLAUDE_API_KEY not configured" };
    return { valid: true };
  }

  async chat({ systemPrompt, messages }, options = {}) {
    if (!this.validateConfig().valid) throw new Error("CLAUDE_API_KEY not configured");

    const truncated = this.truncateMessages(messages, 20);
    // Anthropic requires system as separate field, and messages without system
    const nonSystem = truncated.filter(m => m.role !== "system");
    const system = truncated.filter(m => m.role === "system").map(m => m.content).join("\n") || systemPrompt || "";

    const body = {
      model: this.model,
      system: system,
      messages: nonSystem.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      max_tokens: (options.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS || "2048")) || 2048,
      temperature: (options.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || "0.7")) || 0.7,
    };

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Claude API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    return {
      content: text,
      tokens: {
        prompt: data.usage?.input_tokens,
        completion: data.usage?.output_tokens,
        total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      model: data.model,
      raw: data,
    };
  }
}

module.exports = ClaudeProvider;
