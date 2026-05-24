import { Router, Request, Response } from "express";
import { pool } from "../db";
import { authenticate } from "../middleware/auth";
import { getStockQuote, getCryptoQuote } from "../services/marketData";
import { STARTING_PORTFOLIO_VALUE } from "../constants";

const router = Router();
const TRADES_PER_PAGE = 20;

router.use(authenticate);

interface PortfolioRow {
  id: number;
  cash_balance: string;
}

interface HoldingRow {
  symbol: string;
  asset_type: string;
  quantity: string;
  average_buy_price: string;
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

  throw new Error(`Unsupported asset_type: ${assetType}`);
}

async function getUserPortfolio(userId: number): Promise<PortfolioRow | null> {
  const result = await pool.query<PortfolioRow>(
    `SELECT id, cash_balance FROM portfolios
     WHERE user_id = $1
     ORDER BY id ASC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

router.get("/performance", async (req: Request, res: Response) => {
  try {
    const portfolio = await getUserPortfolio(req.user!.id);

    if (!portfolio) {
      res.status(404).json({ message: "Portfolio not found" });
      return;
    }

    const result = await pool.query(
      `SELECT id, portfolio_id, total_value, cash_balance, recorded_at
       FROM portfolio_snapshots
       WHERE portfolio_id = $1
       ORDER BY recorded_at ASC`,
      [portfolio.id]
    );

    const snapshots = result.rows.map((row) => {
      const totalValue = parseFloat(row.total_value);
      const percentReturn =
        ((totalValue - STARTING_PORTFOLIO_VALUE) / STARTING_PORTFOLIO_VALUE) *
        100;

      return {
        id: row.id,
        portfolio_id: row.portfolio_id,
        total_value: totalValue,
        cash_balance: parseFloat(row.cash_balance),
        recorded_at: row.recorded_at,
        percent_return: parseFloat(percentReturn.toFixed(2)),
      };
    });

    const latest = snapshots[snapshots.length - 1];
    const currentPercentReturn = latest
      ? latest.percent_return
      : 0;

    res.json({
      starting_value: STARTING_PORTFOLIO_VALUE,
      snapshots,
      current_percent_return: currentPercentReturn,
    });
  } catch (err) {
    console.error("Portfolio performance error:", err);
    res.status(500).json({ message: "Failed to fetch portfolio performance" });
  }
});

router.get("/trades", async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const offset = (page - 1) * TRADES_PER_PAGE;

  try {
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
       FROM trades t
       INNER JOIN portfolios p ON t.portfolio_id = p.id
       WHERE p.user_id = $1`,
      [req.user!.id]
    );

    const totalCount = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.max(1, Math.ceil(totalCount / TRADES_PER_PAGE));

    const result = await pool.query(
      `SELECT t.id, t.portfolio_id, t.symbol, t.asset_type, t.trade_type,
              t.quantity, t.price_at_trade, t.total_value, t.created_at
       FROM trades t
       INNER JOIN portfolios p ON t.portfolio_id = p.id
       WHERE p.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user!.id, TRADES_PER_PAGE, offset]
    );

    res.json({
      trades: result.rows.map((row) => ({
        id: row.id,
        portfolio_id: row.portfolio_id,
        symbol: row.symbol,
        asset_type: row.asset_type,
        trade_type: row.trade_type,
        quantity: parseFloat(row.quantity),
        price_at_trade: parseFloat(row.price_at_trade),
        total_value: parseFloat(row.total_value),
        created_at: row.created_at,
      })),
      page,
      perPage: TRADES_PER_PAGE,
      totalCount,
      totalPages,
    });
  } catch (err) {
    console.error("Portfolio trades error:", err);
    res.status(500).json({ message: "Failed to fetch trade history" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const portfolio = await getUserPortfolio(req.user!.id);

    if (!portfolio) {
      res.status(404).json({ message: "Portfolio not found" });
      return;
    }

    const cashBalance = parseFloat(portfolio.cash_balance);

    const holdingsResult = await pool.query<HoldingRow>(
      `SELECT symbol, asset_type, quantity, average_buy_price
       FROM holdings
       WHERE portfolio_id = $1
       ORDER BY symbol ASC`,
      [portfolio.id]
    );

    let totalInvested = 0;
    let totalCurrentValue = 0;

    const holdings = await Promise.all(
      holdingsResult.rows.map(async (row) => {
        const quantity = parseFloat(row.quantity);
        const averageBuyPrice = parseFloat(row.average_buy_price);
        const costBasis = quantity * averageBuyPrice;

        const currentPrice = await getCurrentPrice(row.symbol, row.asset_type);
        const currentValue = quantity * currentPrice;
        const profitLoss = currentValue - costBasis;
        const profitLossPercent =
          costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

        totalInvested += costBasis;
        totalCurrentValue += currentValue;

        return {
          symbol: row.symbol,
          asset_type: row.asset_type,
          quantity,
          average_buy_price: averageBuyPrice,
          current_price: currentPrice,
          current_value: parseFloat(currentValue.toFixed(2)),
          profit_loss: parseFloat(profitLoss.toFixed(2)),
          profit_loss_percent: parseFloat(profitLossPercent.toFixed(2)),
        };
      })
    );

    const totalPortfolioValue = cashBalance + totalCurrentValue;
    const totalProfitLoss = totalCurrentValue - totalInvested;

    res.json({
      cash_balance: cashBalance,
      holdings,
      total_invested: parseFloat(totalInvested.toFixed(2)),
      total_current_value: parseFloat(totalCurrentValue.toFixed(2)),
      total_portfolio_value: parseFloat(totalPortfolioValue.toFixed(2)),
      total_profit_loss: parseFloat(totalProfitLoss.toFixed(2)),
    });
  } catch (err) {
    console.error("Portfolio error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch portfolio";
    res.status(502).json({ message });
  }
});

export default router;
