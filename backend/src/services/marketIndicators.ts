import { getStockHistory } from "./marketData";
import {
  calculateRSI,
  calculateSMA,
  calculateMACD,
  latestValue,
} from "../utils/indicators";

export interface MarketIndicators {
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  macd: number | null;
}

export async function fetchMarketIndicators(
  symbol: string
): Promise<MarketIndicators> {
  const history = await getStockHistory(symbol.toUpperCase(), "daily");
  const closes = history.map((bar) => bar.close);
  const { macd } = calculateMACD(closes);

  const rsi = calculateRSI(closes, 14);

  return {
    rsi: Number.isNaN(rsi) ? null : rsi,
    sma20: latestValue(calculateSMA(closes, 20)),
    sma50: latestValue(calculateSMA(closes, 50)),
    macd: latestValue(macd),
  };
}
