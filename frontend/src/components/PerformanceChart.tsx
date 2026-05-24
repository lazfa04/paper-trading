import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api/axios";
import axios from "axios";

interface Snapshot {
  id: number;
  total_value: number;
  cash_balance: number;
  recorded_at: string;
  percent_return: number;
}

interface PerformanceResponse {
  starting_value: number;
  snapshots: Snapshot[];
  current_percent_return: number;
}

type TimeRange = "1D" | "1W" | "1M" | "All";

const STARTING_VALUE = 10000;

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function filterByRange(
  snapshots: Snapshot[],
  range: TimeRange
): Snapshot[] {
  if (range === "All" || snapshots.length === 0) return snapshots;

  const now = Date.now();
  const ms =
    range === "1D"
      ? 24 * 60 * 60 * 1000
      : range === "1W"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

  const cutoff = now - ms;
  const filtered = snapshots.filter(
    (s) => new Date(s.recorded_at).getTime() >= cutoff
  );

  return filtered.length > 0 ? filtered : snapshots;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function PerformanceChart() {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [range, setRange] = useState<TimeRange>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const { data: response } = await api.get<PerformanceResponse>(
        "/portfolio/performance"
      );
      setData(response);
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Failed to load performance data";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  const chartData = useMemo(() => {
    if (!data?.snapshots.length) return [];
    return filterByRange(data.snapshots, range).map((s) => ({
      ...s,
      date: s.recorded_at,
    }));
  }, [data, range]);

  const percentReturn = useMemo(() => {
    if (chartData.length === 0) return data?.current_percent_return ?? 0;
    return chartData[chartData.length - 1].percent_return;
  }, [chartData, data]);

  const yDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [9000, 11000];
    const values = chartData.map((d) => d.total_value);
    const min = Math.min(...values, STARTING_VALUE);
    const max = Math.max(...values, STARTING_VALUE);
    const pad = (max - min) * 0.1 || 500;
    return [min - pad, max + pad];
  }, [chartData]);

  const gradientOffset = useMemo(() => {
    const [min, max] = yDomain;
    if (max <= STARTING_VALUE) return 0;
    if (min >= STARTING_VALUE) return 1;
    return (max - STARTING_VALUE) / (max - min);
  }, [yDomain]);

  const strokeColor = percentReturn >= 0 ? "#10b981" : "#ef4444";

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-slate-800" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchPerformance}
          className="mt-3 text-sm text-emerald-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="font-semibold text-white">Portfolio Performance</h2>
        <p className="mt-4 text-center text-sm text-slate-400">
          Performance data will appear after hourly snapshots are recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-white">
          Portfolio Performance{" "}
          <span
            className={
              percentReturn >= 0 ? "text-emerald-400" : "text-red-400"
            }
          >
            ({percentReturn >= 0 ? "+" : ""}
            {percentReturn.toFixed(2)}%)
          </span>
        </h2>
        <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/80 p-1">
          {(["1D", "1W", "1M", "All"] as TimeRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                range === r
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#10b981" stopOpacity={0.45} />
              <stop
                offset={gradientOffset}
                stopColor="#10b981"
                stopOpacity={0.05}
              />
              <stop
                offset={gradientOffset}
                stopColor="#ef4444"
                stopOpacity={0.05}
              />
              <stop offset="1" stopColor="#ef4444" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`}
            width={48}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]?.payload) return null;
              const p = payload[0].payload as Snapshot & { date: string };
              return (
                <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium text-white">{formatDate(p.date)}</p>
                  <p className="text-slate-300">
                    Value: {currency.format(p.total_value)}
                  </p>
                  <p
                    className={
                      p.percent_return >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    Return: {p.percent_return >= 0 ? "+" : ""}
                    {p.percent_return.toFixed(2)}%
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine
            y={STARTING_VALUE}
            stroke="#64748b"
            strokeDasharray="6 4"
            label={{
              value: `$${STARTING_VALUE.toLocaleString()}`,
              position: "insideTopRight",
              fill: "#64748b",
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey="total_value"
            stroke={strokeColor}
            strokeWidth={2}
            fill="url(#perfGradient)"
            dot={false}
            activeDot={{ r: 4, fill: strokeColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
