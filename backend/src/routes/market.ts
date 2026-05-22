import { Router, Request, Response } from "express";
import {
  getStockQuote,
  getCryptoQuote,
  getStockHistory,
  searchSymbols,
} from "../services/marketData";

const router = Router();

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

router.get("/quote/:symbol", async (req: Request, res: Response) => {
  const symbol = param(req.params.symbol);
  const type = (req.query.type as string) || "stock";

  try {
    if (type === "crypto") {
      const quote = await getCryptoQuote(symbol);
      res.json(quote);
      return;
    }

    if (type === "stock") {
      const quote = await getStockQuote(symbol);
      res.json(quote);
      return;
    }

    res.status(400).json({ message: 'type must be "stock" or "crypto"' });
  } catch (err) {
    console.error("Quote error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch quote";
    res.status(502).json({ message });
  }
});

router.get("/history/:symbol", async (req: Request, res: Response) => {
  const symbol = param(req.params.symbol);
  const interval =
    (req.query.interval as string) === "weekly" ? "weekly" : "daily";

  try {
    const history = await getStockHistory(symbol, interval);
    res.json(history);
  } catch (err) {
    console.error("History error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch history";
    res.status(502).json({ message });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string;

  if (!q?.trim()) {
    res.status(400).json({ message: "Query parameter q is required" });
    return;
  }

  try {
    const results = await searchSymbols(q.trim());
    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    const message = err instanceof Error ? err.message : "Failed to search symbols";
    res.status(502).json({ message });
  }
});

export default router;
