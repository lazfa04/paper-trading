import { Router, Request, Response } from "express";
import { pool } from "../db";
import { authenticate } from "../middleware/auth";
import { getStockQuote, getCryptoQuote } from "../services/marketData";

const router = Router();

router.use(authenticate);

interface PortfolioRow {
  id: number;
  cash_balance: string;
}

interface HoldingRow {
  id: number;
  portfolio_id: number;
  symbol: string;
  asset_type: string;
  quantity: string;
  average_buy_price: string;
  updated_at: Date;
}

async function getCurrentPrice(
  symbol: string,
  assetType: string
): Promise<number> {
  const upper = symbol.toUpperCase();

  if (assetType === "crypto") {
    const quote = await getCryptoQuote(upper);
    return quote.price;
  }

  if (assetType === "stock") {
    const quote = await getStockQuote(upper);
    return quote.price;
  }

  throw new Error('asset_type must be "stock" or "crypto"');
}

async function getUserPortfolio(userId: number): Promise<PortfolioRow> {
  const result = await pool.query<PortfolioRow>(
    `SELECT id, cash_balance FROM portfolios
     WHERE user_id = $1
     ORDER BY id ASC
     LIMIT 1`,
    [userId]
  );

  if (!result.rows[0]) {
    throw new Error("Portfolio not found");
  }

  return result.rows[0];
}

function toHoldingResponse(row: HoldingRow) {
  return {
    id: row.id,
    portfolio_id: row.portfolio_id,
    symbol: row.symbol,
    asset_type: row.asset_type,
    quantity: parseFloat(row.quantity),
    average_buy_price: parseFloat(row.average_buy_price),
    updated_at: row.updated_at,
  };
}

router.post("/buy", async (req: Request, res: Response) => {
  const { symbol, asset_type, quantity } = req.body;

  if (!symbol || !asset_type || quantity == null) {
    res
      .status(400)
      .json({ message: "symbol, asset_type, and quantity are required" });
    return;
  }

  const qty = parseFloat(quantity);
  if (isNaN(qty) || qty <= 0) {
    res.status(400).json({ message: "quantity must be a positive number" });
    return;
  }

  const upperSymbol = String(symbol).toUpperCase();
  const assetType = String(asset_type).toLowerCase();

  if (assetType !== "stock" && assetType !== "crypto") {
    res.status(400).json({ message: 'asset_type must be "stock" or "crypto"' });
    return;
  }

  try {
    const portfolio = await getUserPortfolio(req.user!.id);
    const price = await getCurrentPrice(upperSymbol, assetType);
    const totalCost = price * qty;
    const cashBalance = parseFloat(portfolio.cash_balance);

    if (cashBalance < totalCost) {
      res.status(400).json({ message: "Insufficient funds" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const balanceResult = await client.query<{ cash_balance: string }>(
        `UPDATE portfolios
         SET cash_balance = cash_balance - $1
         WHERE id = $2
         RETURNING cash_balance`,
        [totalCost.toFixed(2), portfolio.id]
      );

      const holdingResult = await client.query<HoldingRow>(
        `SELECT id, portfolio_id, symbol, asset_type, quantity, average_buy_price, updated_at
         FROM holdings
         WHERE portfolio_id = $1 AND symbol = $2 AND asset_type = $3`,
        [portfolio.id, upperSymbol, assetType]
      );

      let holding: HoldingRow;

      if (holdingResult.rows[0]) {
        const existing = holdingResult.rows[0];
        const existingQty = parseFloat(existing.quantity);
        const existingAvg = parseFloat(existing.average_buy_price);
        const newQty = existingQty + qty;
        const newAvg =
          (existingQty * existingAvg + qty * price) / newQty;

        const updated = await client.query<HoldingRow>(
          `UPDATE holdings
           SET quantity = $1, average_buy_price = $2, updated_at = NOW()
           WHERE id = $3
           RETURNING id, portfolio_id, symbol, asset_type, quantity, average_buy_price, updated_at`,
          [newQty, newAvg.toFixed(2), existing.id]
        );
        holding = updated.rows[0];
      } else {
        const inserted = await client.query<HoldingRow>(
          `INSERT INTO holdings (portfolio_id, symbol, asset_type, quantity, average_buy_price)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, portfolio_id, symbol, asset_type, quantity, average_buy_price, updated_at`,
          [portfolio.id, upperSymbol, assetType, qty, price.toFixed(2)]
        );
        holding = inserted.rows[0];
      }

      await client.query(
        `INSERT INTO trades (portfolio_id, symbol, asset_type, trade_type, quantity, price_at_trade, total_value)
         VALUES ($1, $2, $3, 'buy', $4, $5, $6)`,
        [
          portfolio.id,
          upperSymbol,
          assetType,
          qty,
          price.toFixed(2),
          totalCost.toFixed(2),
        ]
      );

      await client.query("COMMIT");

      res.json({
        holding: toHoldingResponse(holding),
        cash_balance: parseFloat(balanceResult.rows[0].cash_balance),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Buy error:", err);
    const message = err instanceof Error ? err.message : "Failed to execute buy";
    res.status(502).json({ message });
  }
});

router.post("/sell", async (req: Request, res: Response) => {
  const { symbol, asset_type, quantity } = req.body;

  if (!symbol || !asset_type || quantity == null) {
    res
      .status(400)
      .json({ message: "symbol, asset_type, and quantity are required" });
    return;
  }

  const qty = parseFloat(quantity);
  if (isNaN(qty) || qty <= 0) {
    res.status(400).json({ message: "quantity must be a positive number" });
    return;
  }

  const upperSymbol = String(symbol).toUpperCase();
  const assetType = String(asset_type).toLowerCase();

  if (assetType !== "stock" && assetType !== "crypto") {
    res.status(400).json({ message: 'asset_type must be "stock" or "crypto"' });
    return;
  }

  try {
    const portfolio = await getUserPortfolio(req.user!.id);

    const holdingResult = await pool.query<HoldingRow>(
      `SELECT id, portfolio_id, symbol, asset_type, quantity, average_buy_price, updated_at
       FROM holdings
       WHERE portfolio_id = $1 AND symbol = $2 AND asset_type = $3`,
      [portfolio.id, upperSymbol, assetType]
    );

    const holding = holdingResult.rows[0];
    const holdingQty = holding ? parseFloat(holding.quantity) : 0;

    if (!holding || holdingQty < qty) {
      res.status(400).json({ message: "Insufficient holdings" });
      return;
    }

    const price = await getCurrentPrice(upperSymbol, assetType);
    const totalValue = price * qty;
    const avgBuyPrice = parseFloat(holding.average_buy_price);
    const profitLoss = (price - avgBuyPrice) * qty;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const balanceResult = await client.query<{ cash_balance: string }>(
        `UPDATE portfolios
         SET cash_balance = cash_balance + $1
         WHERE id = $2
         RETURNING cash_balance`,
        [totalValue.toFixed(2), portfolio.id]
      );

      const remainingQty = holdingQty - qty;
      let updatedHolding: HoldingRow | null = null;

      if (remainingQty <= 0) {
        await client.query("DELETE FROM holdings WHERE id = $1", [holding.id]);
      } else {
        const updated = await client.query<HoldingRow>(
          `UPDATE holdings
           SET quantity = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING id, portfolio_id, symbol, asset_type, quantity, average_buy_price, updated_at`,
          [remainingQty, holding.id]
        );
        updatedHolding = updated.rows[0];
      }

      await client.query(
        `INSERT INTO trades (portfolio_id, symbol, asset_type, trade_type, quantity, price_at_trade, total_value)
         VALUES ($1, $2, $3, 'sell', $4, $5, $6)`,
        [
          portfolio.id,
          upperSymbol,
          assetType,
          qty,
          price.toFixed(2),
          totalValue.toFixed(2),
        ]
      );

      await client.query("COMMIT");

      res.json({
        profit_loss: parseFloat(profitLoss.toFixed(2)),
        cash_balance: parseFloat(balanceResult.rows[0].cash_balance),
        holding: updatedHolding ? toHoldingResponse(updatedHolding) : null,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Sell error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to execute sell";
    res.status(502).json({ message });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.portfolio_id, t.symbol, t.asset_type, t.trade_type,
              t.quantity, t.price_at_trade, t.total_value, t.created_at
       FROM trades t
       INNER JOIN portfolios p ON t.portfolio_id = p.id
       WHERE p.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.user!.id]
    );

    const trades = result.rows.map((row) => ({
      id: row.id,
      portfolio_id: row.portfolio_id,
      symbol: row.symbol,
      asset_type: row.asset_type,
      trade_type: row.trade_type,
      quantity: parseFloat(row.quantity),
      price_at_trade: parseFloat(row.price_at_trade),
      total_value: parseFloat(row.total_value),
      created_at: row.created_at,
    }));

    res.json(trades);
  } catch (err) {
    console.error("Trade history error:", err);
    res.status(500).json({ message: "Failed to fetch trade history" });
  }
});

export default router;
