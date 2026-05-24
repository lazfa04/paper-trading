import { pool } from "../db";
import { calculatePortfolioValue } from "./portfolioValuation";

export async function recordPortfolioSnapshots(): Promise<void> {
  const portfolios = await pool.query<{ id: number }>(
    "SELECT id FROM portfolios"
  );

  for (const portfolio of portfolios.rows) {
    try {
      const { totalValue, cashBalance } = await calculatePortfolioValue(
        portfolio.id
      );

      await pool.query(
        `INSERT INTO portfolio_snapshots (portfolio_id, total_value, cash_balance)
         VALUES ($1, $2, $3)`,
        [portfolio.id, totalValue, cashBalance]
      );
    } catch (err) {
      console.error(
        `Failed to record snapshot for portfolio ${portfolio.id}:`,
        err
      );
    }
  }
}
