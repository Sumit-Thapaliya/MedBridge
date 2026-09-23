const BaseProvider = require("./BaseProvider");

class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
  }

  validateConfig() {
    if (!this.apiKey) {
      return { valid: false, error: "OPENAI_API_KEY not configured" };
    }
    return { valid: true };
  }

  async chat({ systemPrompt, messages }, options = {}) {
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.error);

    const allMessages = this.buildMessages(systemPrompt, messages);
    const truncated = this.truncateMessages(allMessages, 20);

    const body = {
      model: this.model,
      messages: truncated,
      temperature: (options.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || "0.7")) || 0.7,
      max_tokens: (options.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS || "2048")) || 2048,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || "",
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
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.error);

    const allMessages = this.buildMessages(systemPrompt, messages);
    const body = {
      model: this.model,
      messages: this.truncateMessages(allMessages, 20),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errText}`);
    }

    const reader = response.body.getReader();
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

module.exports = OpenAIProvider;
