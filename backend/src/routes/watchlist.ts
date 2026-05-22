import { Router, Request, Response } from "express";
import { pool } from "../db";
import { authenticate } from "../middleware/auth";
import { getStockQuote, getCryptoQuote } from "../services/marketData";

const router = Router();

router.use(authenticate);

interface WatchlistRow {
  id: number;
  user_id: number;
  symbol: string;
  asset_type: string;
  added_at: Date;
}

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function parseChangePercent(changePercent: string): number {
  return parseFloat(changePercent.replace("%", "").trim());
}

async function fetchPriceAndChange(
  symbol: string,
  assetType: string
): Promise<{ price: number; change_percent: number | null }> {
  const upper = symbol.toUpperCase();

  if (assetType === "crypto") {
    const quote = await getCryptoQuote(upper);
    return { price: quote.price, change_percent: null };
  }

  if (assetType === "stock") {
    const quote = await getStockQuote(upper);
    return {
      price: quote.price,
      change_percent: parseChangePercent(quote.changePercent),
    };
  }

  throw new Error('asset_type must be "stock" or "crypto"');
}

function formatWatchlistItem(row: WatchlistRow, price: number, changePercent: number | null) {
  return {
    id: row.id,
    symbol: row.symbol,
    asset_type: row.asset_type,
    added_at: row.added_at,
    price,
    change_percent: changePercent,
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const result = await pool.query<WatchlistRow>(
      `SELECT id, user_id, symbol, asset_type, added_at
       FROM watchlist
       WHERE user_id = $1
       ORDER BY added_at DESC`,
      [req.user!.id]
    );

    const items = await Promise.all(
      result.rows.map(async (row) => {
        const { price, change_percent } = await fetchPriceAndChange(
          row.symbol,
          row.asset_type
        );
        return formatWatchlistItem(row, price, change_percent);
      })
    );

    res.json(items);
  } catch (err) {
    console.error("Watchlist GET error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch watchlist";
    res.status(502).json({ message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { symbol, asset_type } = req.body;

  if (!symbol || !asset_type) {
    res.status(400).json({ message: "symbol and asset_type are required" });
    return;
  }

  const upperSymbol = String(symbol).toUpperCase();
  const assetType = String(asset_type).toLowerCase();

  if (assetType !== "stock" && assetType !== "crypto") {
    res.status(400).json({ message: 'asset_type must be "stock" or "crypto"' });
    return;
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM watchlist
       WHERE user_id = $1 AND symbol = $2 AND asset_type = $3`,
      [req.user!.id, upperSymbol, assetType]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ message: "Symbol already in watchlist" });
      return;
    }

    const inserted = await pool.query<WatchlistRow>(
      `INSERT INTO watchlist (user_id, symbol, asset_type)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, symbol, asset_type, added_at`,
      [req.user!.id, upperSymbol, assetType]
    );

    const row = inserted.rows[0];
    const { price, change_percent } = await fetchPriceAndChange(
      row.symbol,
      row.asset_type
    );

    res.status(201).json(formatWatchlistItem(row, price, change_percent));
  } catch (err) {
    console.error("Watchlist POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to add to watchlist";
    res.status(502).json({ message });
  }
});

router.delete("/:symbol", async (req: Request, res: Response) => {
  const symbol = param(req.params.symbol).toUpperCase();

  try {
    const result = await pool.query(
      `DELETE FROM watchlist
       WHERE user_id = $1 AND symbol = $2
       RETURNING id`,
      [req.user!.id, symbol]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: "Watchlist item not found" });
      return;
    }

    res.json({ message: "Removed from watchlist", symbol });
  } catch (err) {
    console.error("Watchlist DELETE error:", err);
    res.status(500).json({ message: "Failed to remove from watchlist" });
  }
});

export default router;
