const ProviderFactory = require("./ProviderFactory");
const PromptBuilder = require("./PromptBuilder");
const InventoryContext = require("./InventoryContext");
const ConversationService = require("./ConversationService");
const ContextManager = require("./ContextManager");
const prisma = require("../../config/db");

const contextManager = new ContextManager({ maxMessages: 20, maxTokens: 8000 });

class AIService {
  constructor() {
    this.provider = null;
    this.initProvider();
  }

  initProvider() {
    try {
      const providerName = process.env.LLM_PROVIDER || ProviderFactory.autoDetect();
      this.provider = ProviderFactory.create(providerName);
    } catch (err) {
      console.error("[AIService] Failed to init provider, using mock:", err.message);
      this.provider = ProviderFactory.create("mock");
    }
  }

  // FIX: shared ownership check, used anywhere a conversationId supplied
  // by the client is resolved to a real conversation. Without this, any
  // authenticated user could pass another hospital's conversationId and
  // read/continue their AI chat history — a direct cross-tenant leak,
  // worse than a data-shape bug because it exposes exact prior messages.
  assertConversationOwnership(conversation, userId) {
    if (conversation && conversation.userId && conversation.userId !== userId) {
      throw new Error("Unauthorized: this conversation does not belong to you");
    }
  }

  /**
   * Main entry for AI assistant
   * Handles RAG routing, conversation memory, safety
   */
  async askQuestion({ question, userId, hospitalId, hospitalName, conversationId = null }) {
    const sanitizedQuestion = PromptBuilder.sanitizeInput(question);
    if (!sanitizedQuestion) throw new Error("Question cannot be empty");

    // 1. Get or create conversation for memory
    let conversation;
    if (conversationId) {
      conversation = await ConversationService.getConversation(conversationId);
      this.assertConversationOwnership(conversation, userId); // FIX: added
    }
    if (!conversation) {
      conversation = await ConversationService.getOrCreateLatestConversation(userId, hospitalId);
    }

    // 2. Get previous messages for context
    const previousMessages = await ConversationService.getMessages(conversation.id, 20);

    // 3. Determine if we need inventory context (RAG)
    const needsInventory = PromptBuilder.needsInventoryContext(sanitizedQuestion);
    let inventoryContext = "";
    let contextUsed = [];

    if (needsInventory) {
      inventoryContext = await InventoryContext.getContextForQuery(sanitizedQuestion, hospitalId, userId);
      contextUsed = ["inventory"];
    }

    // 4. Build system prompt with context
    const systemPrompt = PromptBuilder.buildWithInventoryContext(inventoryContext, hospitalName);

    // 5. Build conversation messages for LLM (previous + new)
    const llmMessages = [
      ...previousMessages.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: sanitizedQuestion },
    ];

    // Optimize for token window
    const optimized = contextManager.optimizeMessages(
      [{ role: "system", content: systemPrompt }, ...llmMessages]
    );

    const system = optimized.find(m => m.role === "system")?.content || systemPrompt;
    const chatMessages = optimized.filter(m => m.role !== "system");

    // Add reference context for pronouns
    const refContext = contextManager.buildReferenceContext(chatMessages);
    const finalSystem = refContext ? `${system}\n\n${refContext}` : system;

    // 6. Call provider
    let response;
    try {
      response = await this.provider.chat(
        { systemPrompt: finalSystem, messages: chatMessages },
        { temperature: 0.7, maxTokens: 2048 }
      );
    } catch (err) {
      console.error(`[AIService] Provider ${this.provider.name} error:`, err.message);
      // Fallback to mock if provider fails
      if (this.provider.constructor.name !== "MockProvider") {
        const mock = ProviderFactory.create("mock");
        response = await mock.chat(
          { systemPrompt: finalSystem, messages: chatMessages },
          {}
        );
      } else {
        throw err;
      }
    }

    // 7. Safety filter - ensure we have disclaimer for medical advice
    let finalContent = response.content;
    if (this.isMedicalAdvice(finalContent) && !finalContent.toLowerCase().includes("not medical advice")) {
      finalContent += "\n\n*This is general information only and not medical advice. Please consult a qualified healthcare professional for personal medical decisions.*";
    }

    // 8. Save to conversation history
    await ConversationService.addMessage(conversation.id, "user", sanitizedQuestion, { contextUsed });
    await ConversationService.addMessage(conversation.id, "assistant", finalContent, {
      provider: this.provider.constructor.name,
      model: response.model,
      tokens: response.tokens,
      contextUsed,
    });

    return {
      available: true,
      message: finalContent,
      conversationId: conversation.id,
      model: response.model,
      tokens: response.tokens,
      contextUsed,
      provider: this.provider.constructor.name,
    };
  }

  /**
   * Streaming version - yields chunks
   */
  async *askQuestionStream({ question, userId, hospitalId, hospitalName, conversationId }) {
    const sanitizedQuestion = PromptBuilder.sanitizeInput(question);

    let conversation;
    if (conversationId) {
      conversation = await ConversationService.getConversation(conversationId);
      this.assertConversationOwnership(conversation, userId); // FIX: added
    }
    if (!conversation) {
      conversation = await ConversationService.getOrCreateLatestConversation(userId, hospitalId);
    }
    if (!conversation) conversation = await ConversationService.createConversation(userId, hospitalId);

    const previousMessages = await ConversationService.getMessages(conversation.id, 20);
    const needsInventory = PromptBuilder.needsInventoryContext(sanitizedQuestion);
    let inventoryContext = "";
    if (needsInventory) {
      inventoryContext = await InventoryContext.getContextForQuery(sanitizedQuestion, hospitalId, userId);
    }

    const systemPrompt = PromptBuilder.buildWithInventoryContext(inventoryContext, hospitalName);
    const llmMessages = [
      ...previousMessages.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: sanitizedQuestion },
    ];

    const optimized = contextManager.optimizeMessages(
      [{ role: "system", content: systemPrompt }, ...llmMessages]
    );
    const system = optimized.find(m => m.role === "system")?.content || systemPrompt;
    const chatMessages = optimized.filter(m => m.role !== "system");

    await ConversationService.addMessage(conversation.id, "user", sanitizedQuestion);

    let fullResponse = "";
    try {
      for await (const chunk of this.provider.chatStream({ systemPrompt: system, messages: chatMessages })) {
        fullResponse += chunk;
        yield { chunk, conversationId: conversation.id, done: false };
      }
    } catch (err) {
      console.error("[AIService] Streaming error, fallback to non-stream:", err.message);
      const response = await this.provider.chat({ systemPrompt: system, messages: chatMessages });
      fullResponse = response.content;
      yield { chunk: fullResponse, conversationId: conversation.id, done: false };
    }

    await ConversationService.addMessage(conversation.id, "assistant", fullResponse, {
      provider: this.provider.constructor.name,
    });

    yield { chunk: "", conversationId: conversation.id, done: true, fullContent: fullResponse };
  }

  isMedicalAdvice(text) {
    const lower = text.toLowerCase();
    return (
      lower.includes("should take") ||
      lower.includes("dosage") ||
      lower.includes("prescribe") ||
      lower.includes("diagnosis") ||
      lower.includes("side effect") ||
      lower.includes("treatment")
    );
  }

  async getConversationHistory(conversationId, userId) {
    const conv = await ConversationService.getConversation(conversationId);
    if (!conv) throw new Error("Conversation not found");
    // Check ownership if not memory
    if (conv.userId && conv.userId !== userId) throw new Error("Unauthorized");
    const messages = await ConversationService.getMessages(conversationId, 100);
    return { conversation: conv, messages };
  }

  async getUserConversations(userId) {
    return ConversationService.getUserConversations(userId);
  }

  async deleteConversation(conversationId, userId) {
    return ConversationService.deleteConversation(conversationId, userId);
  }

  async getProviderInfo() {
    return {
      provider: this.provider.constructor.name,
      model: this.provider.model,
      supported: ProviderFactory.getSupportedProviders(),
      current: process.env.LLM_PROVIDER || ProviderFactory.autoDetect(),
    };
  }
}

module.exports = new AIService();
