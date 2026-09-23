/**
 * BaseProvider - Abstract base for all LLM providers
 * Defines the common interface every provider must implement
 */
class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = this.constructor.name;
  }

  /**
   * Main chat completion - must be implemented by each provider
   * @param {Object} params
   * @param {string} params.systemPrompt - System instructions
   * @param {Array} params.messages - Conversation history [{role, content}]
   * @param {Object} params.context - RAG context (inventory, etc)
   * @param {Object} options - Additional options (temperature, maxTokens, stream)
   * @returns {Promise<{content: string, tokens: {prompt, completion, total}, model: string}>}
   */
  async chat({ systemPrompt, messages, context }, options = {}) {
    throw new Error(`${this.name}.chat() not implemented`);
  }

  /**
   * Optional streaming version
   * Should yield chunks
   */
  async *chatStream({ systemPrompt, messages, context }, options = {}) {
    // Default fallback: call non-streaming and yield once
    const result = await this.chat({ systemPrompt, messages, context }, options);
    yield result.content;
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    return { valid: true };
  }

  /**
   * Helper to build messages array with system prompt
   */
  buildMessages(systemPrompt, conversationMessages) {
    const msgs = [];
    if (systemPrompt) {
      msgs.push({ role: "system", content: systemPrompt });
    }
    // Ensure conversation messages are in correct format
    for (const m of conversationMessages || []) {
      msgs.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      });
    }
    return msgs;
  }

  /**
   * Helper to truncate messages to fit token window
   */
  truncateMessages(messages, maxMessages = 20) {
    if (messages.length <= maxMessages) return messages;
    // Keep system prompt + last N messages
    const system = messages.filter(m => m.role === "system");
    const rest = messages.filter(m => m.role !== "system");
    const keep = rest.slice(-maxMessages);
    return [...system, ...keep];
  }
}

module.exports = BaseProvider;
