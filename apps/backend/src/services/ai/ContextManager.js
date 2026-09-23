/**
 * ContextManager - Efficient conversation memory management
 * Handles truncation, summarization, and context window optimization
 */

class ContextManager {
  constructor(options = {}) {
    this.maxMessages = options.maxMessages || 20;
    this.maxTokens = options.maxTokens || 8000;
  }

  /**
   * Optimize conversation history for LLM
   * Keeps recent context, preserves important earlier messages
   */
  optimizeMessages(messages) {
    if (!messages || messages.length === 0) return [];

    // Always keep system messages
    const systemMessages = messages.filter(m => m.role === "system");
    let conversation = messages.filter(m => m.role !== "system");

    // If too many, keep last N
    if (conversation.length > this.maxMessages) {
      // Keep first user message (often contains important context) + last N-1
      const first = conversation[0];
      const rest = conversation.slice(-(this.maxMessages - 1));
      conversation = [first, ...rest];
    }

    // Estimate tokens (rough: 1 token ~ 4 chars)
    let totalChars = [...systemMessages, ...conversation].reduce((sum, m) => sum + (m.content?.length || 0), 0);
    let estimatedTokens = totalChars / 4;

    while (estimatedTokens > this.maxTokens && conversation.length > 2) {
      // Remove oldest non-essential (keep first and last few)
      conversation.splice(1, 1); // Remove second oldest
      totalChars = [...systemMessages, ...conversation].reduce((sum, m) => sum + (m.content?.length || 0), 0);
      estimatedTokens = totalChars / 4;
    }

    return [...systemMessages, ...conversation];
  }

  /**
   * Build reference resolution context
   * Helps model understand pronouns like "it", "that medicine"
   */
  buildReferenceContext(messages) {
    if (!messages || messages.length < 2) return "";

    const recent = messages.slice(-6);
    const medicinesMentioned = new Set();
    
    // Extract medicine names mentioned
    for (const m of recent) {
      const content = m.content?.toLowerCase() || "";
      const commonMeds = ["paracetamol", "ibuprofen", "amoxicillin", "insulin", "ceftriaxone", "azithromycin", "metformin"];
      for (const med of commonMeds) {
        if (content.includes(med)) medicinesMentioned.add(med);
      }
    }

    if (medicinesMentioned.size > 0) {
      return `Recent medicines discussed: ${Array.from(medicinesMentioned).join(", ")}. When user says "it" or "that", likely refers to one of these.`;
    }

    return "";
  }

  /**
   * Should we summarize old conversation?
   */
  needsSummarization(messages) {
    if (!messages) return false;
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    return totalChars > this.maxTokens * 4 * 0.8; // 80% of limit
  }
}

module.exports = ContextManager;
