import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { BarShapeProps } from "recharts";
import api from "../api/axios";
import axios from "axios";

export interface CandlestickChartProps {
  symbol: string;
  assetType: string;
}

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartRow extends OhlcvBar {
  ma7: number | null;
  ma20: number | null;
}

type Period = "1W" | "1M" | "3M";

const CHART_HEIGHT = 360;
const MARGIN = { top: 12, right: 12, left: 8, bottom: 4 };

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function calculateMA(data: OhlcvBar[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((sum, bar) => sum + bar.close, 0) / period;
  });
}

function enrichData(bars: OhlcvBar[]): ChartRow[] {
  const ma7 = calculateMA(bars, 7);
  const ma20 = calculateMA(bars, 20);
  return bars.map((bar, i) => ({
    ...bar,
    ma7: ma7[i],
    ma20: ma20[i],
  }));
}

function sliceForPeriod(bars: OhlcvBar[], period: Period): OhlcvBar[] {
  if (period === "1W") return bars.slice(-7);
  if (period === "1M") return bars.slice(-30);
  return bars;
}

function CandlestickShape(
  props: BarShapeProps & { yScale: (value: number) => number }
) {
  const { x = 0, width = 0, payload, yScale } = props;
  const bar = payload as ChartRow;
  const { open, close, high, low } = bar;

  const isUp = close >= open;
  const color = isUp ? "#10b981" : "#ef4444";
  const cx = x + width / 2;
  const wickTop = yScale(high);
  const wickBottom = yScale(low);
  const bodyTop = yScale(Math.max(open, close));
  const bodyBottom = yScale(Math.min(open, close));
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
  const barWidth = Math.max(width * 0.65, 4);

  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={wickTop}
        y2={wickBottom}
        stroke={color}
        strokeWidth={1.5}
      />
      <rect
        x={cx - barWidth / 2}
        y={bodyTop}
        width={barWidth}
        height={bodyHeight}
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const d = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-white">{formatDate(d.date)}</p>
      <p className="text-slate-300">O: {d.open.toFixed(2)}</p>
      <p className="text-slate-300">H: {d.high.toFixed(2)}</p>
      <p className="text-slate-300">L: {d.low.toFixed(2)}</p>
      <p className="text-slate-300">C: {d.close.toFixed(2)}</p>
      <p className="text-slate-400">V: {d.volume.toLocaleString()}</p>
    </div>
  );
}

export default function CandlestickChart({
  symbol,
  assetType,
}: CandlestickChartProps) {
  const [period, setPeriod] = useState<Period>("1M");
  const [rawData, setRawData] = useState<OhlcvBar[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchHistory = useCallback(async () => {
    if (!symbol) return;

    setLoading(true);
    setError("");

    try {
      const interval = period === "3M" ? "weekly" : "daily";
      const [historyRes, quoteRes] = await Promise.all([
        api.get<OhlcvBar[]>(`/market/history/${symbol.toUpperCase()}`, {
          params: { interval },
        }),
        api.get<{ price: number }>(
          `/market/quote/${symbol.toUpperCase()}`,
          { params: { type: assetType } }
        ),
      ]);

      setRawData(historyRes.data);
      setCurrentPrice(quoteRes.data.price);
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Could not load chart data";
      setError(message);
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, assetType, period]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const chartData = useMemo(() => {
    const sliced = sliceForPeriod(rawData, period);
    return enrichData(sliced);
  }, [rawData, period]);

  const priceDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [0, 100];
    const lows = chartData.map((d) => d.low);
    const highs = chartData.map((d) => d.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const pad = (max - min) * 0.08 || max * 0.05;
    return [min - pad, max + pad];
  }, [chartData]);

  const volumeMax = useMemo(
    () => Math.max(...chartData.map((d) => d.volume), 1),
    [chartData]
  );

  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return { high52: 0, low52: 0, avgVolume: 0 };
    }
    return {
      high52: Math.max(...chartData.map((d) => d.high)),
      low52: Math.min(...chartData.map((d) => d.low)),
      avgVolume: Math.round(
        chartData.reduce((s, d) => s + d.volume, 0) / chartData.length
      ),
    };
  }, [chartData]);

  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const priceScale = useCallback(
    (value: number) => {
      const [min, max] = priceDomain;
      return (
        MARGIN.top +
        plotHeight -
        ((value - min) / (max - min)) * plotHeight
      );
    },
    [priceDomain, plotHeight]
  );

  const renderCandle = useCallback(
    (props: BarShapeProps) => (
      <CandlestickShape {...props} yScale={priceScale} />
    ),
    [priceScale]
  );

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 flex gap-2">
          {(["1W", "1M", "3M"] as Period[]).map((p) => (
            <div
              key={p}
              className="h-8 w-10 animate-pulse rounded-md bg-slate-800"
            />
          ))}
        </div>
        <div
          className="animate-pulse rounded-lg bg-slate-800"
          style={{ height: CHART_HEIGHT }}
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 px-6 text-center"
        style={{ height: CHART_HEIGHT + 80 }}
      >
        <p className="text-red-400">{error}</p>
        <button
          type="button"
          onClick={fetchHistory}
          className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400"
        style={{ height: CHART_HEIGHT }}
      >
        No chart data available
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-white">
          {symbol.toUpperCase()}{" "}
          <span className="text-sm font-normal capitalize text-slate-400">
            {assetType}
          </span>
        </h3>
        <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/80 p-1">
          {(["1W", "1M", "3M"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                period === p
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart
          data={chartData}
          margin={MARGIN}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e293b"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="price"
            domain={priceDomain}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
            width={52}
          />
          <YAxis
            yAxisId="volume"
            domain={[0, volumeMax * 4]}
            hide
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            yAxisId="volume"
            dataKey="volume"
            fill="#475569"
            opacity={0.45}
            barSize={8}
            radius={[1, 1, 0, 0]}
          />
          <Bar
            yAxisId="price"
            dataKey="close"
            shape={renderCandle}
            barSize={14}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ma7"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ma20"
            stroke="#8b5cf6"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-amber-500" />
          MA (7)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-violet-500" />
          MA (20)
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500">52W High</p>
          <p className="mt-0.5 font-medium text-emerald-400">
            {currency.format(stats.high52)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">52W Low</p>
          <p className="mt-0.5 font-medium text-red-400">
            {currency.format(stats.low52)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Avg Volume</p>
          <p className="mt-0.5 font-medium text-slate-200">
            {stats.avgVolume.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Current Price</p>
          <p className="mt-0.5 font-medium text-white">
            {currentPrice != null
              ? currency.format(currentPrice)
              : currency.format(chartData[chartData.length - 1].close)}
          </p>
        </div>
      </div>
    </div>
  );
}
