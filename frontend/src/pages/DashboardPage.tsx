import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { RefreshCw, TrendingUp } from "lucide-react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import PerformanceChart from "../components/PerformanceChart";

interface Holding {
  symbol: string;
  asset_type: string;
  quantity: number;
  average_buy_price: number;
  current_price: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
}

interface Portfolio {
  cash_balance: number;
  holdings: Holding[];
  total_invested: number;
  total_current_value: number;
  total_portfolio_value: number;
  total_profit_loss: number;
}

interface Trade {
  id: number;
  symbol: string;
  asset_type: string;
  trade_type: string;
  quantity: number;
  price_at_trade: number;
  total_value: number;
  created_at: string;
}

const CHART_COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#64748b",
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function pnlClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-slate-400";
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-slate-800 ${className}`} />
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-5"
        >
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <Skeleton className="mb-4 h-6 w-32" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [portfolioRes, tradesRes] = await Promise.all([
        api.get<Portfolio>("/portfolio"),
        api.get<{ trades: Trade[] }>("/portfolio/trades", { params: { page: 1 } }),
      ]);

      setPortfolio(portfolioRes.data);
      setRecentTrades(tradesRes.data.trades.slice(0, 5));
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Failed to load portfolio data.";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPnlPercent = useMemo(() => {
    if (!portfolio || portfolio.total_invested <= 0) return 0;
    return (portfolio.total_profit_loss / portfolio.total_invested) * 100;
  }, [portfolio]);

  const chartData = useMemo(() => {
    if (!portfolio) return [];

    const slices = portfolio.holdings.map((h) => ({
      name: h.symbol,
      value: h.current_value,
    }));

    if (portfolio.cash_balance > 0) {
      slices.push({ name: "Cash", value: portfolio.cash_balance });
    }

    const total = portfolio.total_portfolio_value || 1;
    return slices.map((s) => ({
      ...s,
      percent: (s.value / total) * 100,
    }));
  }, [portfolio]);

  const tradeLink = (holding: Holding, side: "buy" | "sell") =>
    `/trade?symbol=${holding.symbol}&type=${holding.asset_type}&side=${side}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950">
        <header className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
          <Skeleton className="h-8 w-48" />
        </header>
        <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
          <StatsSkeleton />
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TableSkeleton />
            </div>
            <div className="space-y-8">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                <Skeleton className="mb-4 h-6 w-40" />
                <Skeleton className="mx-auto h-48 w-48 rounded-full" />
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                <Skeleton className="mb-4 h-6 w-32" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Dashboard</h1>
              <p className="text-sm text-slate-400">
                Welcome back, {user?.username ?? "trader"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <nav className="hidden gap-4 text-sm sm:flex">
              <Link
                to="/dashboard"
                className="font-medium text-emerald-400"
              >
                Dashboard
              </Link>
              <Link
                to="/trade"
                className="text-slate-400 transition hover:text-white"
              >
                Trade
              </Link>
              <Link
                to="/watchlist"
                className="text-slate-400 transition hover:text-white"
              >
                Watchlist
              </Link>
            </nav>
            <button
              type="button"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:border-emerald-500/50 hover:text-white disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh Prices
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {portfolio && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-sm text-slate-400">Total Portfolio Value</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {currency.format(portfolio.total_portfolio_value)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-sm text-slate-400">Cash Available</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {currency.format(portfolio.cash_balance)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-sm text-slate-400">Total P&L</p>
                <p
                  className={`mt-2 text-2xl font-semibold ${pnlClass(portfolio.total_profit_loss)}`}
                >
                  {portfolio.total_profit_loss >= 0 ? "+" : ""}
                  {currency.format(portfolio.total_profit_loss)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-sm text-slate-400">Total P&L %</p>
                <p
                  className={`mt-2 text-2xl font-semibold ${pnlClass(totalPnlPercent)}`}
                >
                  {formatPercent(totalPnlPercent)}
                </p>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
              <div className="space-y-8 lg:col-span-2">
                <PerformanceChart />

                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
                  <div className="border-b border-slate-800 px-6 py-4">
                    <h2 className="font-semibold text-white">Holdings</h2>
                  </div>
                  {portfolio.holdings.length === 0 ? (
                    <p className="px-6 py-10 text-center text-slate-400">
                      No holdings yet.{" "}
                      <Link to="/trade" className="text-emerald-400 hover:underline">
                        Start trading
                      </Link>
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            <th className="px-4 py-3 font-medium">Symbol</th>
                            <th className="px-4 py-3 font-medium">Type</th>
                            <th className="px-4 py-3 font-medium text-right">
                              Quantity
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              Avg Buy
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              Current
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              Value
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              P&L
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              P&L %
                            </th>
                            <th className="px-4 py-3 font-medium text-right">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.holdings.map((h) => (
                            <tr
                              key={`${h.symbol}-${h.asset_type}`}
                              className="border-b border-slate-800/60 last:border-0"
                            >
                              <td className="px-4 py-3 font-medium text-white">
                                {h.symbol}
                              </td>
                              <td className="px-4 py-3 capitalize text-slate-300">
                                {h.asset_type}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-200">
                                {h.quantity}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-200">
                                {currency.format(h.average_buy_price)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-200">
                                {currency.format(h.current_price)}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-200">
                                {currency.format(h.current_value)}
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-medium ${pnlClass(h.profit_loss)}`}
                              >
                                {h.profit_loss >= 0 ? "+" : ""}
                                {currency.format(h.profit_loss)}
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-medium ${pnlClass(h.profit_loss_percent)}`}
                              >
                                {formatPercent(h.profit_loss_percent)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <Link
                                    to={tradeLink(h, "buy")}
                                    className="rounded-md bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-600/30"
                                  >
                                    Buy More
                                  </Link>
                                  <Link
                                    to={tradeLink(h, "sell")}
                                    className="rounded-md bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 transition hover:bg-red-600/30"
                                  >
                                    Sell
                                  </Link>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-8">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                  <h2 className="mb-4 font-semibold text-white">
                    Asset Allocation
                  </h2>
                  {chartData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      No allocation data
                    </p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {chartData.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={
                                  CHART_COLORS[index % CHART_COLORS.length]
                                }
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) =>
                              currency.format(Number(value ?? 0))
                            }
                            contentStyle={{
                              backgroundColor: "#0f172a",
                              border: "1px solid #334155",
                              borderRadius: "8px",
                            }}
                          />
                          <Legend
                            formatter={(value) => {
                              const item = chartData.find(
                                (d) => d.name === value
                              );
                              return item
                                ? `${value} (${item.percent.toFixed(1)}%)`
                                : value;
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <ul className="mt-4 space-y-2">
                        {chartData.map((item, index) => (
                          <li
                            key={item.name}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="flex items-center gap-2 text-slate-300">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{
                                  backgroundColor:
                                    CHART_COLORS[index % CHART_COLORS.length],
                                }}
                              />
                              {item.name}
                            </span>
                            <span className="text-slate-400">
                              {item.percent.toFixed(1)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                  <h2 className="mb-4 font-semibold text-white">
                    Recent Trades
                  </h2>
                  {recentTrades.length === 0 ? (
                    <p className="text-sm text-slate-400">No trades yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {recentTrades.map((trade) => (
                        <li
                          key={trade.id}
                          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-white">
                              {trade.symbol}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${
                                trade.trade_type === "buy"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-red-500/20 text-red-400"
                              }`}
                            >
                              {trade.trade_type}
                            </span>
                          </div>
                          <div className="text-right text-sm">
                            <p className="text-slate-200">
                              {trade.quantity} @{" "}
                              {currency.format(trade.price_at_trade)}
                            </p>
                            <p className="text-xs text-slate-500">
                              {new Date(trade.created_at).toLocaleString()}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
