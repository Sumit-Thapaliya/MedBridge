const OpenAIProvider = require("./providers/OpenAIProvider");
const GeminiProvider = require("./providers/GeminiProvider");
const ClaudeProvider = require("./providers/ClaudeProvider");
const GroqProvider = require("./providers/GroqProvider");
const OpenRouterProvider = require("./providers/OpenRouterProvider");
const DeepSeekProvider = require("./providers/DeepSeekProvider");
const MockProvider = require("./providers/MockProvider");

const PROVIDERS = {
  openai: OpenAIProvider,
  gemini: GeminiProvider,
  claude: ClaudeProvider,
  anthropic: ClaudeProvider,
  groq: GroqProvider,
  openrouter: OpenRouterProvider,
  deepseek: DeepSeekProvider,
  mock: MockProvider,
};

class ProviderFactory {
  static create(providerName, config = {}) {
    const name = (providerName || process.env.LLM_PROVIDER || "mock").toLowerCase().trim();
    const ProviderClass = PROVIDERS[name];

    if (!ProviderClass) {
      console.warn(`[AI] Unknown provider "${name}", falling back to mock. Supported: ${Object.keys(PROVIDERS).join(", ")}`);
      return new MockProvider(config);
    }

    const instance = new ProviderClass(config);
    const validation = instance.validateConfig();

    if (!validation.valid) {
      // If mock is explicitly disabled, throw; otherwise fallback to mock for dev
      const mockEnabled = (process.env.MOCK_LLM_ENABLED || "true").toLowerCase() === "true";
      if (name !== "mock" && mockEnabled) {
        console.warn(`[AI] ${name} invalid config (${validation.error}), falling back to MockProvider for development`);
        return new MockProvider(config);
      }
      if (name !== "mock") {
        throw new Error(`LLM provider ${name} misconfigured: ${validation.error}`);
      }
    }

    console.log(`[AI] Using LLM provider: ${name} (${instance.model})`);
    return instance;
  }

  static getSupportedProviders() {
    return Object.keys(PROVIDERS);
  }

  static autoDetect() {
    // Auto-detect based on available keys
    if (process.env.OPENROUTER_API_KEY) return "openrouter";
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.GEMINI_API_KEY) return "gemini";
    if (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY) return "claude";
    if (process.env.GROQ_API_KEY) return "groq";
    if (process.env.DEEPSEEK_API_KEY) return "deepseek";
    return "mock";
  }
}

module.exports = ProviderFactory;
