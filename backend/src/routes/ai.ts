import { Router, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { authenticate } from "../middleware/auth";
import { fetchMarketIndicators } from "../services/marketIndicators";

const router = Router();

router.use(authenticate);

const SYSTEM_PROMPT = `You are a trading education assistant for beginners. Explain trading concepts clearly and simply. Never give financial advice or tell users to buy or sell. Always remind them this is paper trading for learning.`;

const MODEL = "claude-sonnet-4-20250514";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return new Anthropic({ apiKey });
}

interface PortfolioContext {
  total_portfolio_value?: number;
  cash_balance?: number;
  cash_remaining?: number;
  total_invested?: number;
  holdings_count?: number;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalyzeTradeBody {
  symbol: string;
  trade_type: string;
  quantity: number;
  price: number;
  total_value: number;
  portfolio_context?: PortfolioContext;
  follow_up_question?: string;
  previous_analysis?: string;
  conversation_history?: ConversationMessage[];
}

function formatIndicator(value: number | null): string {
  return value != null ? value.toFixed(2) : "unavailable";
}

function buildAnalyzeTradePrompt(
  body: AnalyzeTradeBody,
  indicators: Awaited<ReturnType<typeof fetchMarketIndicators>>
): string {
  const ctx = body.portfolio_context ?? {};
  const cash =
    ctx.cash_remaining ?? ctx.cash_balance ?? "unknown";
  const action = body.trade_type.toLowerCase() === "sell" ? "sold" : "bought";

  return `The user just completed a paper trade (simulated, no real money):

Trade details:
- Symbol: ${body.symbol.toUpperCase()}
- Action: They ${action} ${body.quantity} shares/units
- Price per unit: $${body.price.toFixed(2)}
- Total trade value: $${body.total_value.toFixed(2)}

Current technical indicators for ${body.symbol.toUpperCase()}:
- RSI (14): ${formatIndicator(indicators.rsi)}
- SMA (20-day): ${formatIndicator(indicators.sma20)}
- SMA (50-day): ${formatIndicator(indicators.sma50)}
- MACD line: ${formatIndicator(indicators.macd)}

Portfolio context:
- Total portfolio value: ${
    ctx.total_portfolio_value != null
      ? `$${ctx.total_portfolio_value.toFixed(2)}`
      : "unknown"
  }
- Cash remaining: ${
    typeof cash === "number" ? `$${cash.toFixed(2)}` : cash
  }
- Number of holdings: ${ctx.holdings_count ?? "unknown"}

Please explain in clear, beginner-friendly language:
1. What this trade means in the context of their portfolio
2. What the current indicators (RSI, SMA, MACD) suggest about the symbol's recent price action — educational only, not advice
3. Two or three things they could watch going forward as they learn
4. One educational concept related to this trade (e.g. dollar-cost averaging, position sizing, RSI basics)

Keep the response concise and well-structured with short paragraphs or bullet points.`;
}

function buildFollowUpPrompt(
  body: AnalyzeTradeBody,
  indicators: Awaited<ReturnType<typeof fetchMarketIndicators>>
): string {
  const historyText =
    body.conversation_history
      ?.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n") ??
    body.previous_analysis ??
    "";

  return `The user is learning about a paper trade they made on ${body.symbol.toUpperCase()} (simulated).

Original trade: ${body.trade_type} ${body.quantity} @ $${body.price.toFixed(2)} (total $${body.total_value.toFixed(2)})

Current indicators for ${body.symbol.toUpperCase()}:
- RSI: ${formatIndicator(indicators.rsi)}
- SMA20: ${formatIndicator(indicators.sma20)}
- MACD: ${formatIndicator(indicators.macd)}

Prior conversation:
${historyText}

Follow-up question: ${body.follow_up_question}

Answer the follow-up clearly and concisely. Stay educational — no buy/sell advice. Remind them this is paper trading.`;
}

router.post("/analyze-trade", async (req: Request, res: Response) => {
  const {
    symbol,
    trade_type,
    quantity,
    price,
    total_value,
    portfolio_context,
    follow_up_question,
    previous_analysis,
    conversation_history,
  } = req.body as AnalyzeTradeBody;

  if (!symbol || !trade_type || quantity == null || price == null || total_value == null) {
    res.status(400).json({
      message:
        "symbol, trade_type, quantity, price, and total_value are required",
    });
    return;
  }

  try {
    const client = getClient();
    const indicators = await fetchMarketIndicators(symbol);
    const tradeBody: AnalyzeTradeBody = {
      symbol,
      trade_type,
      quantity: Number(quantity),
      price: Number(price),
      total_value: Number(total_value),
      portfolio_context,
      follow_up_question,
      previous_analysis,
      conversation_history,
    };

    const userPrompt = follow_up_question?.trim()
      ? buildFollowUpPrompt(tradeBody, indicators)
      : buildAnalyzeTradePrompt(tradeBody, indicators);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    stream.on("text", (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    await stream.finalMessage();
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Analyze trade error:", err);
    if (!res.headersSent) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze trade";
      res.status(502).json({ message });
    } else {
      res.write(
        `data: ${JSON.stringify({ error: "Failed to complete analysis" })}\n\n`
      );
      res.end();
    }
  }
});

router.post("/explain-indicator", async (req: Request, res: Response) => {
  const { indicator, value, symbol } = req.body as {
    indicator?: string;
    value?: number;
    symbol?: string;
  };

  const allowed = ["RSI", "MACD", "SMA"];

  if (!indicator || !allowed.includes(indicator)) {
    res.status(400).json({
      message: 'indicator must be "RSI", "MACD", or "SMA"',
    });
    return;
  }

  if (value == null || !symbol) {
    res.status(400).json({ message: "value and symbol are required" });
    return;
  }

  try {
    const client = getClient();
    const upper = symbol.toUpperCase();

    const userPrompt = `Symbol: ${upper}
Indicator: ${indicator}
Current value: ${Number(value).toFixed(2)}

Explain in plain English what this ${indicator} value means for ${upper} right now. Focus on education, not buy/sell advice. Keep your response under 100 words.`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = message.content[0];
    const explanation =
      block.type === "text" ? block.text : "Unable to generate explanation.";

    res.json({ explanation: explanation.trim() });
  } catch (err) {
    console.error("Explain indicator error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to explain indicator";
    res.status(502).json({ message });
  }
});

export default router;
