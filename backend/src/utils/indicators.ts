export function calculateRSI(
  closePrices: number[],
  period: number = 14
): number {
  if (closePrices.length < period + 1) {
    return NaN;
  }

  const changes: number[] = [];
  for (let i = 1; i < closePrices.length; i++) {
    changes.push(closePrices[i] - closePrices[i - 1]);
  }

  const recentChanges = changes.slice(-period);
  let avgGain = 0;
  let avgLoss = 0;

  for (const change of recentChanges) {
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.round(rsi * 100) / 100;
}

export function calculateRSISeries(
  closePrices: number[],
  period: number = 14
): (number | null)[] {
  const result: (number | null)[] = Array(closePrices.length).fill(null);

  for (let i = period; i < closePrices.length; i++) {
    const rsi = calculateRSI(closePrices.slice(0, i + 1), period);
    result[i] = Number.isNaN(rsi) ? null : rsi;
  }

  return result;
}

export function calculateSMA(
  prices: number[],
  period: number
): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) {
      return null;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((sum, price) => sum + price, 0) / period;
  });
}

export function calculateEMA(
  prices: number[],
  period: number
): (number | null)[] {
  const result: (number | null)[] = Array(prices.length).fill(null);

  if (prices.length < period) {
    return result;
  }

  const multiplier = 2 / (period + 1);
  let ema =
    prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

export function calculateMACD(prices: number[]): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  const macd: (number | null)[] = prices.map((_, i) => {
    if (ema12[i] == null || ema26[i] == null) {
      return null;
    }
    return ema12[i]! - ema26[i]!;
  });

  const macdForSignal = macd.map((value) => value ?? 0);
  const signalRaw = calculateEMA(macdForSignal, 9);
  const signal: (number | null)[] = signalRaw.map((value, i) =>
    macd[i] == null ? null : value
  );

  const histogram: (number | null)[] = macd.map((value, i) => {
    if (value == null || signal[i] == null) {
      return null;
    }
    return value - signal[i]!;
  });

  return { macd, signal, histogram };
}

export function latestValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) {
      return values[i];
    }
  }
  return null;
}
