import { useRef, useEffect, useState } from "react";
import clsx from "clsx";
import {
  Sparkles,
  Send,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Bot,
  User,
  AlertTriangle,
  Loader2,
  Database,
  Shield,
  Lightbulb,
  Pill,
  ShieldAlert,
  Tag,
  CalendarClock,
  PackageCheck,
  Building2,
} from "lucide-react";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { useAIChat } from "../context/AIChatContext";
import "./AIAssistant.css";

const PROMPT_GROUPS = [
  {
    label: "Medicine knowledge",
    items: [
      { icon: Pill, text: "What does Paracetamol do?" },
      { icon: ShieldAlert, text: "What are side effects of Ibuprofen?" },
    ],
  },
  {
    label: "Inventory & pricing",
    items: [
      { icon: Tag, text: "How much does Paracetamol cost?" },
      { icon: CalendarClock, text: "Show medicines expiring this month" },
      { icon: PackageCheck, text: "Do we have Insulin available?" },
      { icon: Building2, text: "Which hospital has Ceftriaxone?" },
    ],
  },
];

function SimpleMarkdown({ text }) {
  if (!text) return null;
  const parts = text.split("\n").map((line, idx) => {
    if (!line.trim()) return <div key={idx} style={{ height: 8 }} />;
    const boldSplit = line.split(/(\*\*.*?\*\*)/g);
    return (
      <p key={idx} style={{ margin: "4px 0", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
        {boldSplit.map((chunk, j) => {
          if (chunk.startsWith("**") && chunk.endsWith("**")) {
            return <strong key={j}>{chunk.slice(2, -2)}</strong>;
          }
          if (chunk.includes("`")) {
            const codeSplit = chunk.split(/(`.*?`)/g);
            return codeSplit.map((c, k) => {
              if (c.startsWith("`") && c.endsWith("`")) {
                return <code key={k} style={{ background: "var(--canvas)", padding: "2px 6px", borderRadius: 4, fontSize: "0.85em" }}>{c.slice(1, -1)}</code>;
              }
              return <span key={k}>{c}</span>;
            });
          }
          return <span key={j}>{chunk}</span>;
        })}
      </p>
    );
  });
  return <div>{parts}</div>;
}

function TypingDots() {
  return (
    <div className="ai-typing">
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
    </div>
  );
}

export default function AIAssistant() {
  const {
    messages,
    input,
    setInput,
    loading,
    conversationId,
    error,
    sendMessage,
    handleClear,
  } = useAIChat();

  const [copiedId, setCopiedId] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const endRef = useRef(null);
  const msgsRef = useRef(null);

  // Scroll only the messages container. scrollIntoView() would also scroll
  // overflow:hidden ancestors (the card), which clipped the head/footer on
  // small screens where the content is taller than the card.
  useEffect(() => {
    const box = msgsRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const handleCopy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  return (
    <div className="ai-page ai-page-full">
      <PageHeader
        title="AI Assistant"
        subtitle="MedBridge AI - Full screen, live inventory, pricing, medical knowledge"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="outline" size="sm" onClick={handleClear}>
              <Trash2 size={14} /> Clear
            </Button>
          </div>
        }
      />

      <Card className={clsx("ai-chat-card ai-chat-card-full", sideOpen && "ai-side-open")}>
        <aside className="ai-side">
          <div className="ai-side-title"><Lightbulb size={14} /> Suggested questions</div>
          {PROMPT_GROUPS.map((g) => (
            <div className="ai-side-group" key={g.label}>
              <div className="ai-side-group-label">{g.label}</div>
              <div className="ai-side-list">
                {g.items.map(({ icon: Icon, text }) => (
                  <button
                    key={text}
                    className="ai-side-item"
                    disabled={loading}
                    onClick={() => { sendMessage(text); setSideOpen(false); }}
                  >
                    <Icon size={14} className="ai-side-item-icon" />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="ai-side-note">Answers use your live inventory when relevant.</p>
        </aside>
        <div className="ai-main">
        <div className="ai-chat-head">
          <div className="ai-chat-head-icon"><Sparkles size={16} color="#8DD3CA" /></div>
          <div style={{ flex: 1 }}>
            <div className="ai-chat-head-name">MedBridge AI</div>
            <div className="ai-chat-head-status">
              {loading ? (
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Loader2 size={12} className="spin" /> Thinking...</span>
              ) : (
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ display: "flex", gap: 3, alignItems: "center" }}><Shield size={12} /> Safe</span>
                  <span style={{ display: "flex", gap: 3, alignItems: "center" }}><Database size={12} /> Live RAG</span>
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="ai-side-toggle"
            onClick={() => setSideOpen((v) => !v)}
          >
            <Lightbulb size={12} /> {sideOpen ? "Hide tips" : "Tips"}
          </button>
          {conversationId && <span className="ai-chat-conv-id" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{conversationId.slice(0, 8)}…</span>}
        </div>

        <div className="ai-chat-messages" ref={msgsRef}>
          {messages.map((m) => (
            <div key={m.id} className={clsx("ai-chat-row", m.role === "user" ? "ai-chat-row-user" : "ai-chat-row-assistant")}>
              <div className="ai-chat-avatar">{m.role === "user" ? <User size={14} /> : <Bot size={14} />}</div>
              <div className={clsx("ai-chat-bubble", m.role === "user" ? "ai-chat-bubble-user" : "ai-chat-bubble-assistant", m.isError && "ai-chat-bubble-error")}>
                {m.role === "assistant" && m.text === "" && m.streaming ? <TypingDots /> : (
                  <>
                    {m.role === "user" ? <div className="ai-chat-text">{m.text}</div> : <SimpleMarkdown text={m.text} />}
                    <div className="ai-chat-meta">
                      <span>{m.timestamp?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      {m.model && <span>{m.provider} {m.model?.slice(0, 18)}</span>}
                      {m.contextUsed?.length > 0 && <span>RAG: {m.contextUsed.join(", ")}</span>}
                    </div>
                  </>
                )}
                {m.role === "assistant" && !m.streaming && m.text && (
                  <div className="ai-chat-actions">
                    <button className="ai-chat-action-btn" onClick={() => handleCopy(m.id, m.text)} title="Copy">
                      {copiedId === m.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button className="ai-chat-action-btn" onClick={() => {
                      const idx = messages.findIndex(mm => mm.id === m.id);
                      const userMsg = idx > 0 ? messages[idx-1] : null;
                      if (userMsg) sendMessage(userMsg.text);
                    }} title="Regenerate">
                      <RotateCcw size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && !messages.some((m) => m.streaming) && <div className="ai-chat-row ai-chat-row-assistant"><div className="ai-chat-avatar"><Bot size={14} /></div><div className="ai-chat-bubble ai-chat-bubble-assistant"><TypingDots /></div></div>}
          {error && <div className="ai-error"><AlertTriangle size={14} /> {error}</div>}
          <div ref={endRef} />
        </div>

        <div className="ai-chat-footer">
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="ai-chat-form">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about cost, expiry, medicines..." className="ai-chat-input" disabled={loading} />
            <button type="submit" className="ai-chat-send-btn" disabled={loading || !input.trim()}>
              {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
        </div>
      </Card>
    </div>
  );
}
