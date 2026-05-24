import { pool } from "../db";
import { getStockQuote, getCryptoQuote } from "./marketData";

interface HoldingRow {
  symbol: string;
  asset_type: string;
  quantity: string;
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

export async function calculatePortfolioValue(portfolioId: number): Promise<{
  totalValue: number;
  cashBalance: number;
}> {
  const portfolioResult = await pool.query<{ cash_balance: string }>(
    "SELECT cash_balance FROM portfolios WHERE id = $1",
    [portfolioId]
  );

  if (!portfolioResult.rows[0]) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }

  const cashBalance = parseFloat(portfolioResult.rows[0].cash_balance);

  const holdingsResult = await pool.query<HoldingRow>(
    `SELECT symbol, asset_type, quantity FROM holdings WHERE portfolio_id = $1`,
    [portfolioId]
  );

  let holdingsValue = 0;

  for (const row of holdingsResult.rows) {
    const quantity = parseFloat(row.quantity);
    const price = await getCurrentPrice(row.symbol, row.asset_type);
    holdingsValue += quantity * price;
  }

  const totalValue = cashBalance + holdingsValue;

  return {
    totalValue: parseFloat(totalValue.toFixed(2)),
    cashBalance: parseFloat(cashBalance.toFixed(2)),
  };
}
