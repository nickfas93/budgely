"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Quanto gastei esse mês?",
  "Onde estou gastando mais?",
  "Estou dentro do orçamento?",
  "Quais meus 5 maiores gastos?",
  "Como está minha taxa de poupança?",
  "Me mostra as últimas transações de alimentação",
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full animate-bounce"
          style={{
            background: "#063669",
            opacity: 0.4,
            animationDelay: `${i * 0.15}s`,
            animationDuration: "0.8s",
          }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 mr-3 mt-1"
          style={{ background: "#274e82", color: "#9cc0fb" }}
        >
          Fin
        </div>
      )}
      <div
        className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
        style={
          isUser
            ? { background: "#063669", color: "#ffffff", borderBottomRightRadius: 4 }
            : { background: "#ffffff", color: "#0b1c30", borderBottomLeftRadius: 4, border: "1px solid #e5eeff" }
        }
      >
        {msg.content}
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      const reply = data.reply ?? data.error ?? "Erro ao processar resposta.";
      setMessages([...newHistory, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...newHistory, { role: "assistant", content: "❌ Erro de conexão. Tente novamente." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 65px)" }}>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "#e5eeff", background: "#f8f9ff" }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm"
          style={{ background: "#274e82", color: "#9cc0fb" }}
        >
          Fin
        </div>
        <div>
          <h1
            className="font-bold text-base"
            style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
          >
            Fin — Assistente Financeiro
          </h1>
          <p className="text-xs" style={{ color: "#737784" }}>
            Converse com seus dados · edite categorias · analise gastos
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-8">
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-xl mx-auto mb-4"
                style={{ background: "#274e82", color: "#9cc0fb" }}
              >
                Fin
              </div>
              <h2
                className="text-2xl font-bold mb-2"
                style={{ fontFamily: "var(--font-manrope), Manrope, sans-serif", color: "#0b1c30" }}
              >
                Como posso te ajudar?
              </h2>
              <p className="text-sm" style={{ color: "#737784" }}>
                Faça perguntas sobre seus gastos ou peça para editar transações.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-left px-4 py-3 rounded-xl text-sm font-medium transition-all hover:shadow-sm"
                  style={{
                    background: "#ffffff",
                    color: "#434653",
                    border: "1px solid #e5eeff",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#eff4ff")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && (
              <div className="flex justify-start mb-4">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 mr-3 mt-1"
                  style={{ background: "#274e82", color: "#9cc0fb" }}
                >
                  Fin
                </div>
                <div
                  className="rounded-2xl px-4 py-3"
                  style={{ background: "#ffffff", border: "1px solid #e5eeff", borderBottomLeftRadius: 4 }}
                >
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-6 py-4 border-t" style={{ borderColor: "#e5eeff", background: "#f8f9ff" }}>
        <div className="max-w-3xl mx-auto flex gap-3 items-end">
          <div
            className="flex-1 flex items-end rounded-2xl border px-4 py-3"
            style={{ background: "#ffffff", borderColor: "#e5eeff" }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre seus gastos ou peça uma edição..."
              rows={1}
              disabled={loading}
              className="flex-1 resize-none bg-transparent text-sm outline-none"
              style={{
                color: "#0b1c30",
                maxHeight: 120,
                lineHeight: "1.5",
              }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
              }}
            />
          </div>
          <button
            onClick={() => void send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-opacity disabled:opacity-40"
            style={{ background: "#063669", color: "#ffffff" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <p className="text-center text-[10px] mt-2" style={{ color: "#c3c6d5" }}>
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  );
}
