export interface TradeObject {
  symbol: string;
  asset_type: string;
  trade_type: "buy" | "sell";
  quantity: number;
  price: number;
  total_value: number;
  profit_loss?: number | null;
  portfolio_context: {
    total_portfolio_value: number;
    cash_balance: number;
    holdings_count?: number;
  };
}

/** @deprecated Use TradeObject */
export type TradeInsightTrade = TradeObject;
