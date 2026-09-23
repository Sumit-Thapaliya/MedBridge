const prisma = require("../../config/db");

/**
 * ConversationService - Manages AI conversation history
 * Uses DB if available, falls back to in-memory for dev/test
 */

// In-memory fallback storage
const memoryStore = new Map(); // conversationId -> { messages, metadata }

class ConversationService {
  constructor() {
    this.useMemoryFallback = false;
  }

  async createConversation(userId, hospitalId, title = null) {
    try {
      const conv = await prisma.conversation.create({
        data: {
          userId,
          hospitalId,
          title: title || "New Conversation",
        },
      });
      return conv;
    } catch (err) {
      console.warn("[ConversationService] DB unavailable, using memory fallback:", err.message);
      this.useMemoryFallback = true;
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const conv = {
        id,
        userId,
        hospitalId,
        title: title || "New Conversation",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
      };
      memoryStore.set(id, conv);
      return conv;
    }
  }

  async getConversation(conversationId) {
    if (this.useMemoryFallback || conversationId.startsWith("mem_")) {
      return memoryStore.get(conversationId) || null;
    }
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      return conv;
    } catch {
      this.useMemoryFallback = true;
      return memoryStore.get(conversationId) || null;
    }
  }

  async getOrCreateLatestConversation(userId, hospitalId) {
    try {
      // Try to get latest conversation for this user
      const existing = await prisma.conversation.findFirst({
        where: { userId, hospitalId },
        orderBy: { updatedAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });

      if (existing) {
        // If last message is older than 1 hour, create new conversation
        const lastMsgTime = existing.messages?.length ? new Date(existing.messages[existing.messages.length - 1].createdAt) : new Date(existing.updatedAt);
        const hoursSince = (Date.now() - lastMsgTime.getTime()) / (1000 * 60 * 60);
        if (hoursSince > 1) {
          return this.createConversation(userId, hospitalId);
        }
        return existing;
      }

      return this.createConversation(userId, hospitalId);
    } catch (err) {
      this.useMemoryFallback = true;
      // Memory fallback logic
      const userConvs = Array.from(memoryStore.values()).filter(c => c.userId === userId);
      if (userConvs.length > 0) {
        const sorted = userConvs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        return sorted[0];
      }
      return this.createConversation(userId, hospitalId);
    }
  }

  async addMessage(conversationId, role, content, metadata = null) {
    if (this.useMemoryFallback || conversationId.startsWith("mem_")) {
      const conv = memoryStore.get(conversationId);
      if (!conv) throw new Error("Conversation not found");
      const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        conversationId,
        role,
        content,
        metadata,
        createdAt: new Date(),
      };
      conv.messages = conv.messages || [];
      conv.messages.push(msg);
      conv.updatedAt = new Date();
      memoryStore.set(conversationId, conv);
      return msg;
    }

    try {
      const message = await prisma.aIMessage.create({
        data: {
          conversationId,
          role,
          content,
          metadata: metadata || {},
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return message;
    } catch (err) {
      console.warn("[ConversationService] DB error, switching to memory:", err.message);
      this.useMemoryFallback = true;
      return this.addMessage(conversationId, role, content, metadata);
    }
  }

  async getMessages(conversationId, limit = 50) {
    if (this.useMemoryFallback || conversationId.startsWith("mem_")) {
      const conv = memoryStore.get(conversationId);
      return (conv?.messages || []).slice(-limit);
    }

    try {
      const messages = await prisma.aIMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return messages;
    } catch {
      this.useMemoryFallback = true;
      const conv = memoryStore.get(conversationId);
      return (conv?.messages || []).slice(-limit);
    }
  }

  async getUserConversations(userId, limit = 20) {
    if (this.useMemoryFallback) {
      return Array.from(memoryStore.values())
        .filter(c => c.userId === userId)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, limit);
    }

    try {
      return await prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          messages: { orderBy: { createdAt: "asc" }, take: 1 },
        },
      });
    } catch {
      this.useMemoryFallback = true;
      return this.getUserConversations(userId, limit);
    }
  }

  async deleteConversation(conversationId, userId) {
    if (this.useMemoryFallback || conversationId.startsWith("mem_")) {
      const conv = memoryStore.get(conversationId);
      if (conv && conv.userId === userId) {
        memoryStore.delete(conversationId);
        return true;
      }
      return false;
    }

    try {
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!conv || conv.userId !== userId) return false;

      await prisma.conversation.delete({ where: { id: conversationId } });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new ConversationService();
