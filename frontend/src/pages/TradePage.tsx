import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import axios from "axios";
import api from "../api/axios";
import AITradeInsight from "../components/AITradeInsight";
import CandlestickChart from "../components/CandlestickChart";
import { useToast } from "../context/ToastContext";
import { Skeleton } from "../components/ui/Skeleton";
import type { TradeObject } from "../types/trade";

interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: string;
  volume: number;
  latestTradingDay: string;
}

interface CryptoQuote {
  symbol: string;
  price: number;
  lastRefreshed: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
}

interface Holding {
  symbol: string;
  asset_type: string;
  quantity: number;
  average_buy_price: number;
  current_price: number;
}

interface Portfolio {
  cash_balance: number;
  holdings: Holding[];
}

type Side = "buy" | "sell";

function normalizeAssetType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("crypto") || t.includes("currency")) return "crypto";
  return "stock";
}

function parseChangePercent(value: string): number {
  return parseFloat(value.replace("%", "").trim()) || 0;
}

function portfolioTotalValue(portfolio: Portfolio): number {
  const holdingsValue = portfolio.holdings.reduce(
    (sum, h) => sum + h.quantity * h.current_price,
    0
  );
  return portfolio.cash_balance + holdingsValue;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function TradePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const symbol = (searchParams.get("symbol") || "AAPL").toUpperCase();
  const assetType = normalizeAssetType(
    searchParams.get("type") ||
      searchParams.get("asset_type") ||
      "stock"
  );
  const initialSide = searchParams.get("side") === "sell" ? "sell" : "buy";

  const [side, setSide] = useState<Side>(initialSide);
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<StockQuote | CryptoQuote | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [insightTrade, setInsightTrade] = useState<TradeObject | null>(
    null
  );
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const isStock = assetType === "stock";
  const stockQuote = isStock ? (quote as StockQuote | null) : null;

  const currentHolding = useMemo(
    () =>
      portfolio?.holdings.find(
        (h) =>
          h.symbol.toUpperCase() === symbol &&
          h.asset_type === assetType
      ),
    [portfolio, symbol, assetType]
  );

  const qtyNum = parseFloat(quantity) || 0;
  const price = quote?.price ?? 0;
  const estimatedTotal = qtyNum * price;

  const fetchQuote = useCallback(async () => {
    try {
      const { data } = await api.get<StockQuote | CryptoQuote>(
        `/market/quote/${symbol}`,
        { params: { type: assetType } }
      );
      setQuote(data);
    } catch {
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [symbol, assetType]);

  const fetchPortfolio = useCallback(async () => {
    try {
      const { data } = await api.get<Portfolio>("/portfolio");
      setPortfolio(data);
    } catch {
      setPortfolio(null);
    }
  }, []);

  useEffect(() => {
    setQuoteLoading(true);
    fetchQuote();
    fetchPortfolio();
  }, [fetchQuote, fetchPortfolio]);

  useEffect(() => {
    setSide(initialSide);
    setQuantity("");
    setFormError("");
  }, [symbol, assetType, initialSide]);

  useEffect(() => {
    const interval = setInterval(fetchQuote, 30_000);
    return () => clearInterval(interval);
  }, [fetchQuote]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<SearchResult[]>("/market/search", {
          params: { q: searchQuery.trim() },
        });
        setSearchResults(data);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const navigateToSymbol = (sym: string, type: string) => {
    const normalized = normalizeAssetType(type);
    setSearchParams({ symbol: sym.toUpperCase(), type: normalized });
    setSearchQuery("");
    setSearchOpen(false);
    navigate(`/trade?symbol=${sym.toUpperCase()}&type=${normalized}`);
  };

  const handleSubmit = async () => {
    setFormError("");

    if (!qtyNum || qtyNum <= 0) {
      setFormError("Enter a valid quantity.");
      return;
    }

    if (side === "sell" && (!currentHolding || currentHolding.quantity < qtyNum)) {
      setFormError("Insufficient holdings.");
      return;
    }

    setSubmitting(true);

    try {
      const endpoint = side === "buy" ? "/trades/buy" : "/trades/sell";
      const { data } = await api.post(endpoint, {
        symbol,
        asset_type: assetType,
        quantity: qtyNum,
      });

      const { data: freshPortfolio } = await api.get<Portfolio>("/portfolio");
      setPortfolio(freshPortfolio);
      await fetchQuote();

      const tradePrice = price;
      const totalValue = qtyNum * tradePrice;

      setInsightTrade({
        symbol,
        asset_type: assetType,
        trade_type: side,
        quantity: qtyNum,
        price: tradePrice,
        total_value: totalValue,
        profit_loss:
          side === "sell" && data.profit_loss != null
            ? Number(data.profit_loss)
            : undefined,
        portfolio_context: {
          total_portfolio_value: portfolioTotalValue(freshPortfolio),
          cash_balance: freshPortfolio.cash_balance,
          holdings_count: freshPortfolio.holdings.length,
        },
      });

      if (side === "sell" && data.profit_loss != null) {
        const pnl = Number(data.profit_loss);
        const sign = pnl >= 0 ? "+" : "";
        showToast(
          `Sold ${qtyNum} ${symbol} — P&L: ${sign}${currency.format(pnl)}`,
          pnl >= 0 ? "success" : "info"
        );
      } else {
        showToast(`Bought ${qtyNum} ${symbol} successfully`, "success");
      }

      setQuantity("");
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Trade failed. Please try again.";
      setFormError(message);
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const change = stockQuote?.change ?? 0;
  const changePercent = stockQuote
    ? parseChangePercent(stockQuote.changePercent)
    : 0;
  const isPositive = change >= 0;
  const lastUpdated = isStock
    ? stockQuote?.latestTradingDay
    : (quote as CryptoQuote | null)?.lastRefreshed;

  return (
    <div className="space-y-4 font-sans text-slate-200">
        {/* Quote panel */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3">
                <h1 className="font-mono text-2xl font-bold text-white">
                  {symbol}
                </h1>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase text-slate-400">
                  {assetType}
                </span>
              </div>
              {quoteLoading ? (
                <Skeleton className="mt-2 h-10 w-32" />
              ) : quote ? (
                <p className="mt-1 font-mono text-4xl font-semibold text-white">
                  {currency.format(quote.price)}
                </p>
              ) : (
                <p className="mt-1 text-red-400">Quote unavailable</p>
              )}
            </div>

            {stockQuote && (
              <div className="flex gap-8 font-mono text-sm">
                <div>
                  <p className="text-xs uppercase text-slate-500">Change</p>
                  <p
                    className={
                      isPositive ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {isPositive ? "+" : ""}
                    {stockQuote.change.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">Change %</p>
                  <p
                    className={
                      isPositive ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {isPositive ? "+" : ""}
                    {changePercent.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">Updated</p>
                  <p className="text-slate-300">{lastUpdated ?? "—"}</p>
                </div>
              </div>
            )}

            {!isStock && quote && (
              <div className="font-mono text-sm">
                <p className="text-xs uppercase text-slate-500">Updated</p>
                <p className="text-slate-300">
                  {(quote as CryptoQuote).lastRefreshed}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Chart + order form */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_320px]">
          <section className="min-w-0">
            <CandlestickChart symbol={symbol} assetType={assetType} />
          </section>

          <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-4 flex rounded-lg border border-slate-700 p-1">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`flex-1 rounded-md py-2 text-sm font-semibold uppercase tracking-wide transition ${
                  side === "buy"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`flex-1 rounded-md py-2 text-sm font-semibold uppercase tracking-wide transition ${
                  side === "sell"
                    ? "bg-red-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Sell
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
              <p className="text-xs uppercase text-slate-500">Cash available</p>
              <p className="font-mono text-lg text-white">
                {portfolio
                  ? currency.format(portfolio.cash_balance)
                  : "—"}
              </p>
            </div>

            {side === "sell" && (
              <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                <p className="text-xs uppercase text-slate-500">
                  Holdings ({symbol})
                </p>
                <p className="font-mono text-lg text-white">
                  {currentHolding
                    ? `${currentHolding.quantity} @ ${currency.format(currentHolding.average_buy_price)}`
                    : "None"}
                </p>
              </div>
            )}

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs uppercase text-slate-500">
                Quantity
              </span>
              <input
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-white outline-none focus:border-emerald-500/60"
              />
            </label>

            <div className="mb-4 rounded-lg border border-slate-800 px-3 py-2">
              <p className="text-xs text-slate-500">
                {side === "buy" ? "Total cost" : "Total value"}
              </p>
              <p className="font-mono text-xl text-white">
                {price > 0
                  ? currency.format(estimatedTotal)
                  : "—"}
              </p>
              {price > 0 && (
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  @ {currency.format(price)} / unit
                </p>
              )}
            </div>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {formError}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !quote}
              className={`w-full rounded-lg py-3 text-sm font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                side === "buy"
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-red-600 hover:bg-red-500 text-white"
              }`}
            >
              {submitting
                ? "Processing…"
                : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
            </button>
          </aside>
        </div>

        {/* Symbol search */}
        <section
          ref={searchRef}
          className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        >
          <label className="flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder="Search symbols (e.g. AAPL, BTC)…"
              className="w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-slate-600"
            />
          </label>

          {searchOpen && searchResults.length > 0 && (
            <ul className="absolute left-4 right-4 top-full z-40 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
              {searchResults.map((r) => (
                <li key={`${r.symbol}-${r.region}`}>
                  <button
                    type="button"
                    onClick={() => navigateToSymbol(r.symbol, r.type)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-slate-800"
                  >
                    <span>
                      <span className="font-mono font-semibold text-emerald-400">
                        {r.symbol}
                      </span>
                      <span className="ml-2 text-slate-400">{r.name}</span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {r.type} · {r.region}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

      {insightTrade && (
        <AITradeInsight
          trade={insightTrade}
          onClose={() => setInsightTrade(null)}
        />
      )}
    </div>
  );
}
