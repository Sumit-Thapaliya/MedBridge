// AI integration seam — now powered by real LLM with RAG
// Supports multiple providers via backend abstraction

import { request } from "./httpClient";

export const aiService = {
  isEnabled: true,

  async getForecastInsight() {
    try {
      return await request("/ai/forecast-insight");
    } catch (err) {
      return {
        available: false,
        message:
          err.message ||
          "AI-powered demand forecasting isn't connected yet. Start the ML service on port 8000.",
      };
    }
  },

  async getSmartMatchSuggestions() {
    try {
      return await request("/ai/smart-match");
    } catch (err) {
      return {
        available: false,
        message:
          err.message ||
          "Smart exchange matching is offline. Start the ML service on port 8000.",
      };
    }
  },

  async getProviderInfo() {
    try {
      return await request("/ai/provider");
    } catch {
      return { provider: "mock", model: "mock-llm" };
    }
  },

  async getConversations() {
    try {
      return await request("/ai/conversations");
    } catch {
      return [];
    }
  },

  async getConversationHistory(conversationId) {
    try {
      return await request(`/ai/conversations/${conversationId}`);
    } catch (err) {
      throw err;
    }
  },

  async askAssistant(question, conversationId = null) {
    try {
      const payload = { question };
      if (conversationId) payload.conversationId = conversationId;
      const res = await request("/ai/assistant", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return {
        available: res.available !== false,
        message: res.message || res.answer || "No response.",
        conversationId: res.conversationId,
        model: res.model,
        provider: res.provider,
        contextUsed: res.contextUsed,
      };
    } catch (err) {
      return {
        available: false,
        message:
          err.message ||
          "The MedBridge Assistant could not reach the API.",
      };
    }
  },

  // Streaming version using SSE
  async askAssistantStream(question, conversationId, onChunk, onComplete, onError) {
    const token = localStorage.getItem("medbridge_token");
    const base = import.meta.env.VITE_API_URL || "/api";

    try {
      const payload = { question };
      if (conversationId) payload.conversationId = conversationId;

      const response = await fetch(`${base}/ai/assistant/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Stream failed ${response.status}: ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let finalConversationId = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === "[DONE]") continue;
          try {
            const data = JSON.parse(jsonStr);
            if (data.chunk) {
              fullContent += data.chunk;
              onChunk && onChunk(data.chunk, fullContent);
            }
            if (data.conversationId) finalConversationId = data.conversationId;
            if (data.done) {
              onComplete && onComplete(fullContent, finalConversationId);
              return;
            }
            if (data.error) {
              onError && onError(new Error(data.error));
              return;
            }
          } catch {}
        }
      }

      onComplete && onComplete(fullContent, finalConversationId);
    } catch (err) {
      onError && onError(err);
    }
  },

  async deleteConversation(conversationId) {
    try {
      await request(`/ai/conversations/${conversationId}`, { method: "DELETE" });
      return true;
    } catch {
      return false;
    }
  },
};
