import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import api from "../api/axios";
import type { TradeObject } from "../types/trade";

interface MarketIndicators {
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  macd: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AITradeInsightProps {
  trade: TradeObject;
  onClose: () => void;
}

const API_BASE = "http://localhost:5000/api";

function renderSimpleMarkdown(text: string) {
  return text.split("\n").map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={lineIndex} className="mb-2 last:mb-0">
        {parts.map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={i} className="font-semibold text-white">
                {part.slice(2, -2)}
              </strong>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </p>
    );
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
    </div>
  );
}

async function streamAnalyzeTrade(
  body: Record<string, unknown>,
  onChunk: (text: string) => void
): Promise<void> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}/ai/analyze-trade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? "Failed to get AI insight"
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as { text?: string; error?: string };
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) onChunk(parsed.text);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

export default function AITradeInsight({ trade, onClose }: AITradeInsightProps) {
  const [visible, setVisible] = useState(false);
  const [indicators, setIndicators] = useState<MarketIndicators | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const buildRequestBody = useCallback(
    (followUpQuestion?: string) => {
      const base = {
        symbol: trade.symbol,
        trade_type: trade.trade_type,
        quantity: trade.quantity,
        price: trade.price,
        total_value: trade.total_value,
        portfolio_context: {
          total_portfolio_value: trade.portfolio_context.total_portfolio_value,
          cash_balance: trade.portfolio_context.cash_balance,
          cash_remaining: trade.portfolio_context.cash_balance,
          holdings_count: trade.portfolio_context.holdings_count,
        },
      };

      if (followUpQuestion) {
        return {
          ...base,
          follow_up_question: followUpQuestion,
          previous_analysis: analysis,
          conversation_history: messages,
        };
      }
      return base;
    },
    [trade, analysis, messages]
  );

  const fetchIndicators = useCallback(async () => {
    try {
      const { data } = await api.get<MarketIndicators>(
        `/market/history/${trade.symbol}`,
        { params: { interval: "daily" } }
      );
      setIndicators({
        rsi: data.rsi,
        sma20: data.sma20,
        sma50: data.sma50,
        macd: data.macd,
      });
    } catch {
      setIndicators(null);
    }
  }, [trade.symbol]);

  const runAnalysis = useCallback(
    async (followUpQuestion?: string) => {
      setStreaming(true);
      setError("");

      let accumulated = "";

      try {
        await streamAnalyzeTrade(buildRequestBody(followUpQuestion), (chunk) => {
          accumulated += chunk;
          if (followUpQuestion) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  role: "assistant",
                  content: accumulated,
                };
              } else {
                next.push({ role: "assistant", content: accumulated });
              }
              return next;
            });
          } else {
            setAnalysis(accumulated);
          }
        });

        if (followUpQuestion && accumulated) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: accumulated };
            }
            return next;
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load insight";
        setError(message);
      } finally {
        setStreaming(false);
        setLoading(false);
      }
    },
    [buildRequestBody]
  );

  const initialLoad = useRef(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (initialLoad.current) return;
    initialLoad.current = true;
    fetchIndicators();
    runAnalysis();
  }, [fetchIndicators, runAnalysis]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [analysis, messages, streaming]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const handleFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    const question = followUp.trim();
    if (!question || streaming) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);
    setFollowUp("");
    await runAnalysis(question);
  };

  const rsi = indicators?.rsi;
  const rsiLabel =
    rsi == null
      ? "N/A"
      : rsi > 70
        ? "Overbought"
        : rsi < 30
          ? "Oversold"
          : "Neutral";
  const rsiColor =
    rsi == null
      ? "bg-slate-700 text-slate-300"
      : rsi > 70
        ? "bg-red-500/20 text-red-400"
        : rsi < 30
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-slate-700 text-slate-300";

  const sma20 = indicators?.sma20;
  const aboveSma20 = sma20 != null && trade.price >= sma20;

  const macdHist = indicators?.macd?.histogram;
  const macdBullish = macdHist != null ? macdHist >= 0 : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 transition-opacity"
        aria-label="Close panel"
        onClick={handleClose}
      />

      <aside
        className={`relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-300 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-white">
            AI Trade Insight — {trade.symbol}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          {loading && !analysis ? (
            <TypingIndicator />
          ) : (
            <div className="prose-sm text-sm leading-relaxed text-slate-300">
              {renderSimpleMarkdown(analysis)}
            </div>
          )}

          {messages.length > 0 && (
            <div className="mt-6 space-y-4 border-t border-slate-800 pt-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user"
                      ? "rounded-lg bg-slate-800/80 px-3 py-2 text-sm text-slate-200"
                      : "text-sm text-slate-300"
                  }
                >
                  {msg.role === "user" ? (
                    <p>
                      <span className="font-medium text-emerald-400">You: </span>
                      {msg.content}
                    </p>
                  ) : msg.content ? (
                    renderSimpleMarkdown(msg.content)
                  ) : (
                    <TypingIndicator />
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && (indicators || streaming) && (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${rsiColor}`}
              >
                RSI: {rsi != null ? rsi.toFixed(1) : "—"} · {rsiLabel}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  aboveSma20
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/20 text-amber-400"
                }`}
              >
                {sma20 != null
                  ? aboveSma20
                    ? "Above SMA20 ✓"
                    : "Below SMA20"
                  : "SMA20 —"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  macdBullish === true
                    ? "bg-emerald-500/20 text-emerald-400"
                    : macdBullish === false
                      ? "bg-red-500/20 text-red-400"
                      : "bg-slate-700 text-slate-300"
                }`}
              >
                MACD:{" "}
                {macdBullish === true
                  ? "Bullish"
                  : macdBullish === false
                    ? "Bearish"
                    : "—"}
              </span>
            </div>
          )}
        </div>

        <form
          onSubmit={handleFollowUp}
          className="border-t border-slate-800 px-5 py-3"
        >
          <label className="mb-1.5 block text-xs text-slate-500">
            Ask a follow-up
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="e.g. What is RSI?"
              disabled={streaming || loading}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={streaming || loading || !followUp.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>

        <footer className="border-t border-slate-800 px-5 py-3 text-center text-xs text-slate-500">
          This is for educational purposes only. Not financial advice.
        </footer>
      </aside>
    </div>
  );
}
