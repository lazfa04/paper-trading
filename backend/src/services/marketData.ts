const BASE_URL = "https://www.alphavantage.co/query";
const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchAlphaVantage(
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_KEY is not set");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (typeof data.Note === "string") {
    throw new Error(data.Note);
  }
  if (typeof data.Information === "string") {
    throw new Error(data.Information);
  }
  if (typeof data["Error Message"] === "string") {
    throw new Error(data["Error Message"] as string);
  }

  return data;
}

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: string;
  volume: number;
  latestTradingDay: string;
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const cacheKey = `stock-quote:${symbol.toUpperCase()}`;
  const cached = getCached<StockQuote>(cacheKey);
  if (cached) return cached;

  const data = await fetchAlphaVantage({
    function: "GLOBAL_QUOTE",
    symbol: symbol.toUpperCase(),
  });

  const quote = data["Global Quote"] as Record<string, string> | undefined;
  if (!quote?.["05. price"]) {
    throw new Error(`Quote not found for symbol: ${symbol}`);
  }

  const result: StockQuote = {
    symbol: quote["01. symbol"],
    price: parseFloat(quote["05. price"]),
    change: parseFloat(quote["09. change"]),
    changePercent: quote["10. change percent"],
    volume: parseInt(quote["06. volume"], 10),
    latestTradingDay: quote["07. latest trading day"],
  };

  setCache(cacheKey, result);
  return result;
}

export interface CryptoQuote {
  symbol: string;
  price: number;
  lastRefreshed: string;
}

export async function getCryptoQuote(symbol: string): Promise<CryptoQuote> {
  const upper = symbol.toUpperCase();
  const cacheKey = `crypto-quote:${upper}`;
  const cached = getCached<CryptoQuote>(cacheKey);
  if (cached) return cached;

  const data = await fetchAlphaVantage({
    function: "CURRENCY_EXCHANGE_RATE",
    from_currency: upper,
    to_currency: "USD",
  });

  const rate = data["Realtime Currency Exchange Rate"] as
    | Record<string, string>
    | undefined;

  if (!rate?.["5. Exchange Rate"]) {
    throw new Error(`Crypto quote not found for symbol: ${symbol}`);
  }

  const result: CryptoQuote = {
    symbol: rate["1. From_Currency Code"],
    price: parseFloat(rate["5. Exchange Rate"]),
    lastRefreshed: rate["6. Last Refreshed"],
  };

  setCache(cacheKey, result);
  return result;
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getStockHistory(
  symbol: string,
  interval: "daily" | "weekly"
): Promise<OhlcvBar[]> {
  const upper = symbol.toUpperCase();
  const cacheKey = `stock-history:${upper}:${interval}`;
  const cached = getCached<OhlcvBar[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchAlphaVantage({
    function: interval === "weekly" ? "TIME_SERIES_WEEKLY" : "TIME_SERIES_DAILY",
    symbol: upper,
  });

  const seriesKey =
    interval === "weekly" ? "Weekly Time Series" : "Time Series (Daily)";
  const series = data[seriesKey] as Record<string, Record<string, string>> | undefined;

  if (!series) {
    throw new Error(`History not found for symbol: ${symbol}`);
  }

  const result: OhlcvBar[] = Object.entries(series)
    .slice(0, 30)
    .map(([date, bar]) => ({
      date,
      open: parseFloat(bar["1. open"]),
      high: parseFloat(bar["2. high"]),
      low: parseFloat(bar["3. low"]),
      close: parseFloat(bar["4. close"]),
      volume: parseInt(bar["5. volume"], 10),
    }))
    .reverse();

  setCache(cacheKey, result);
  return result;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
}

export async function searchSymbols(
  keywords: string
): Promise<SymbolSearchResult[]> {
  const cacheKey = `symbol-search:${keywords.toLowerCase()}`;
  const cached = getCached<SymbolSearchResult[]>(cacheKey);
  if (cached) return cached;

  const data = await fetchAlphaVantage({
    function: "SYMBOL_SEARCH",
    keywords,
  });

  const matches = data.bestMatches as Record<string, string>[] | undefined;

  if (!matches?.length) {
    setCache(cacheKey, []);
    return [];
  }

  const result: SymbolSearchResult[] = matches.map((match) => ({
    symbol: match["1. symbol"],
    name: match["2. name"],
    type: match["3. type"],
    region: match["4. region"],
  }));

  setCache(cacheKey, result);
  return result;
}
