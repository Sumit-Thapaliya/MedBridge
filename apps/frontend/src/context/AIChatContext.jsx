import { createContext, useContext, useEffect, useState } from "react";
import { aiService } from "../services/aiService";
import { useAuth } from "./AuthContext";

const AIChatContext = createContext(null);

const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  text: "Hi, I'm MedBridge AI — your intelligent healthcare inventory assistant.\n\nI can help with:\n- Medical info: medicines, side effects, interactions, diseases, first aid\n- Live inventory: expiring meds, low stock, costs, exchange requests, hospital search\n- Conversation memory: ask follow-ups like 'Can I take it with Ibuprofen?'\n- Costs: ask 'How much does Paracetamol cost?' for live pricing\n\nSafety: I provide general info only, not diagnosis or prescriptions.",
  timestamp: new Date(),
};

export function AIChatProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [providerInfo, setProviderInfo] = useState(null);
  const [error, setError] = useState("");

  // Fetch provider info once, when a session starts.
  useEffect(() => {
    try {
      if (aiService.getProviderInfo && typeof aiService.getProviderInfo === "function") {
        aiService.getProviderInfo().then(setProviderInfo).catch(() => setProviderInfo({ provider: "mock", model: "mock-llm" }));
      } else {
        setProviderInfo({ provider: "mock", model: "mock-llm" });
      }
    } catch {
      setProviderInfo({ provider: "mock", model: "mock-llm" });
    }
  }, []);

  // The one place chat state actually gets wiped: logout. This covers the
  // normal "Sign out" button AND the delete-account flow, since both end
  // up calling the same logout() in AuthContext, which flips
  // isAuthenticated to false. A real page reload also clears it, but for
  // free — reload wipes all JS memory anyway, nothing extra needed for
  // that case.
  useEffect(() => {
    if (!isAuthenticated) {
      resetChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const resetChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    setLoading(false);
    setConversationId(null);
    setError("");
  };

  const sendMessage = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setError("");
    const userMsg = { id: `u_${Date.now()}`, role: "user", text: question, timestamp: new Date() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    const canStream = aiService.askAssistantStream && typeof aiService.askAssistantStream === "function";
    const assistantId = `a_${Date.now()}`;
    setMessages((m) => [...m, { id: assistantId, role: "assistant", text: "", timestamp: new Date(), streaming: canStream }]);

    let streamed = false;
    if (canStream) {
      try {
        await aiService.askAssistantStream(
          question,
          conversationId,
          (chunk, full) => {
            streamed = true;
            setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, text: full, streaming: true } : msg));
          },
          (full, convId) => {
            if (convId) setConversationId(convId);
            setMessages((prev) => prev.map((msg) => msg.id === assistantId ? { ...msg, text: full, streaming: false, timestamp: new Date() } : msg));
            setLoading(false);
          },
          () => {
            if (!streamed) {
              setMessages((prev) => prev.filter((msg) => msg.id !== assistantId));
              fallback(question);
            }
          }
        );
        return;
      } catch {
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantId));
      }
    } else {
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantId));
    }

    await fallback(question);
  };

  const fallback = async (question) => {
    try {
      const res = await aiService.askAssistant(question, conversationId);
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((m) => m.filter((msg) => !msg.streaming).concat([
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: res.message || "No response",
          timestamp: new Date(),
          model: res.model,
          provider: res.provider,
          contextUsed: res.contextUsed,
          isError: !res.available,
        },
      ]));
      if (!res.available) setError(res.message);
    } catch (err) {
      setError(err.message || "Failed");
      setMessages((m) => m.filter((msg) => !msg.streaming).concat([
        { id: `e_${Date.now()}`, role: "assistant", text: `Error: ${err.message}`, isError: true, timestamp: new Date() },
      ]));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([
      { id: "welcome", role: "assistant", text: "Conversation cleared. How can I help?", timestamp: new Date() },
    ]);
    setConversationId(null);
    setError("");
  };

  const value = {
    messages,
    input,
    setInput,
    loading,
    conversationId,
    providerInfo,
    error,
    sendMessage,
    handleClear,
  };

  return <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>;
}

export function useAIChat() {
  const ctx = useContext(AIChatContext);
  if (!ctx) throw new Error("useAIChat must be used within AIChatProvider");
  return ctx;
}
