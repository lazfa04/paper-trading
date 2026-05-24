import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Trash2, TrendingUp } from "lucide-react";
import axios from "axios";
import api from "../api/axios";

interface WatchlistItem {
  id: number;
  symbol: string;
  asset_type: string;
  added_at: string;
  price: number;
  change_percent: number | null;
  name?: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
}

function normalizeAssetType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("crypto") || t.includes("currency")) return "crypto";
  return "stock";
}

function changeFromPercent(price: number, changePercent: number): number {
  return (price * changePercent) / (100 + changePercent);
}

function pnlClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-slate-400";
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const nameMapRef = useRef<Record<string, string>>({});

  const itemKey = (symbol: string, assetType: string) =>
    `${symbol}:${assetType}`;

  const mergeNames = useCallback((list: WatchlistItem[]): WatchlistItem[] => {
    return list.map((item) => ({
      ...item,
      name: nameMapRef.current[itemKey(item.symbol, item.asset_type)],
    }));
  }, []);

  const fetchWatchlist = useCallback(async () => {
    try {
      const { data } = await api.get<WatchlistItem[]>("/watchlist");
      setItems(mergeNames(data));
      setLastUpdated(new Date());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mergeNames]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  useEffect(() => {
    const refreshInterval = setInterval(fetchWatchlist, 60_000);
    return () => clearInterval(refreshInterval);
  }, [fetchWatchlist]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (lastUpdated) {
        setSecondsAgo(
          Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
        );
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

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

  const handleAdd = async (result: SearchResult) => {
    setAddError("");
    setAdding(true);
    const assetType = normalizeAssetType(result.type);

    try {
      const { data } = await api.post<WatchlistItem>("/watchlist", {
        symbol: result.symbol,
        asset_type: assetType,
      });

      nameMapRef.current[itemKey(data.symbol, data.asset_type)] =
        result.name;

      setItems((prev) =>
        mergeNames([{ ...data, name: result.name }, ...prev])
      );
      setSearchQuery("");
      setSearchOpen(false);
      setLastUpdated(new Date());
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Failed to add symbol.";
      setAddError(message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (
    e: ReactMouseEvent,
    symbol: string
  ) => {
    e.stopPropagation();
    try {
      await api.delete(`/watchlist/${symbol}`);
      setItems((prev) => prev.filter((i) => i.symbol !== symbol));
    } catch {
      /* ignore */
    }
  };

  const goToTrade = (item: WatchlistItem) => {
    navigate(`/trade?symbol=${item.symbol}&type=${item.asset_type}`);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Watchlist</h1>
              <p className="text-sm text-slate-400">
                Track stocks and crypto
                {lastUpdated && (
                  <span className="ml-2 text-slate-500">
                    · Last updated: {secondsAgo}s ago
                  </span>
                )}
              </p>
            </div>
          </div>
          <nav className="hidden gap-4 text-sm sm:flex">
            <Link
              to="/dashboard"
              className="text-slate-400 transition hover:text-white"
            >
              Dashboard
            </Link>
            <Link
              to="/trade"
              className="text-slate-400 transition hover:text-white"
            >
              Trade
            </Link>
            <Link to="/watchlist" className="font-medium text-emerald-400">
              Watchlist
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        {/* Add symbol search */}
        <section
          ref={searchRef}
          className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-5"
        >
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
            <Plus className="h-4 w-4 text-emerald-400" />
            Add to watchlist
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setAddError("");
              }}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder="Search symbols (e.g. AAPL, BTC)…"
              disabled={adding}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-10 pr-4 text-white outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
            />
          </div>

          {addError && (
            <p className="mt-2 text-sm text-red-400">{addError}</p>
          )}

          {searchOpen && searchResults.length > 0 && (
            <ul className="absolute left-5 right-5 top-full z-40 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
              {searchResults.map((r) => (
                <li key={`${r.symbol}-${r.region}`}>
                  <button
                    type="button"
                    onClick={() => handleAdd(r)}
                    disabled={adding}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-semibold text-emerald-400">
                        {r.symbol}
                      </span>
                      <span className="ml-2 text-slate-400">{r.name}</span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {normalizeAssetType(r.type)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Watchlist table */}
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-slate-800"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-slate-400">
                Add stocks or crypto to track them here
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="px-4 py-3 font-medium">Symbol</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Price</th>
                    <th className="px-4 py-3 font-medium text-right">Change</th>
                    <th className="px-4 py-3 font-medium text-right">
                      Change %
                    </th>
                    <th className="px-4 py-3 font-medium">Added</th>
                    <th className="px-4 py-3 font-medium text-right">
                      Remove
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const changePct = item.change_percent ?? 0;
                    const change =
                      item.change_percent != null
                        ? changeFromPercent(item.price, changePct)
                        : null;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => goToTrade(item)}
                        className="cursor-pointer border-b border-slate-800/60 transition last:border-0 hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          {item.symbol}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-slate-300">
                          {item.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-400">
                          {item.asset_type}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-200">
                          {currency.format(item.price)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-medium ${
                            change != null
                              ? pnlClass(change)
                              : "text-slate-500"
                          }`}
                        >
                          {change != null ? (
                            <>
                              {change >= 0 ? "+" : ""}
                              {change.toFixed(2)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-medium ${
                            item.change_percent != null
                              ? pnlClass(changePct)
                              : "text-slate-500"
                          }`}
                        >
                          {item.change_percent != null ? (
                            <>
                              {changePct >= 0 ? "+" : ""}
                              {changePct.toFixed(2)}%
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {new Date(item.added_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => handleRemove(e, item.symbol)}
                            className="rounded-md p-1.5 text-slate-500 transition hover:bg-red-500/20 hover:text-red-400"
                            aria-label={`Remove ${item.symbol}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
