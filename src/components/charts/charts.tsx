"use client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter,
  ComposedChart, Tooltip, XAxis, YAxis, Legend,
} from "recharts";

const AXIS = { stroke: "#556173", fontSize: 10, tickLine: false, axisLine: { stroke: "#1f2a37" } } as const;
const GRID = <CartesianGrid stroke="#1f2a37" strokeDasharray="2 4" vertical={false} />;
const TT = {
  contentStyle: { background: "#131a24", border: "1px solid #2b3a4c", borderRadius: 3, fontSize: 11, padding: "6px 8px" },
  labelStyle: { color: "#7d8a9c" },
  itemStyle: { padding: 0 },
};
const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#94a3b8"];
const t = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export function OddsHistoryChart({ data, books, height = 260 }: { data: Record<string, number | string | null>[]; books: { key: string; name: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="at" tickFormatter={t} {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(2)} width={44} />
        <Tooltip {...TT} labelFormatter={(l) => new Date(String(l)).toUTCString().slice(5, 22)} formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))} />
        <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" />
        <Line type="stepAfter" dataKey="best" name="Best" stroke="#e2e8f0" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="average" name="Average" stroke="#7d8a9c" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        {books.map((b, i) => (
          <Line key={b.key} type="stepAfter" dataKey={b.key} name={b.name} stroke={PALETTE[i % PALETTE.length]} strokeOpacity={0.55} strokeWidth={1} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ConsensusChart({ data, height = 140 }: { data: { at: string; consensus: number | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="at" tickFormatter={t} {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} domain={["auto", "auto"]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={44} />
        <Tooltip {...TT} formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} labelFormatter={(l) => new Date(String(l)).toUTCString().slice(5, 22)} />
        <Area type="monotone" dataKey="consensus" name="No-vig consensus" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MomentumChart({ data, height = 140 }: { data: { point: number; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -24, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="point" {...AXIS} />
        <YAxis {...AXIS} domain={[-10, 10]} />
        <ReferenceLine y={0} stroke="#2b3a4c" />
        <Tooltip {...TT} />
        <Bar dataKey="value" name="Momentum" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? "#3b82f6" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BankrollChart({ data, height = 220 }: { data: { at: string; bankroll: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="at" tickFormatter={(v: string) => v.slice(5, 10)} {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} domain={["auto", "auto"]} width={52} />
        <Tooltip {...TT} labelFormatter={(l) => String(l).slice(0, 10)} formatter={(v) => Number(v).toFixed(2)} />
        <Area type="monotone" dataKey="bankroll" name="Bankroll" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ProfitBars({ data, height = 200 }: { data: { key: string; profit: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="key" {...AXIS} interval={0} tick={{ fontSize: 9 }} />
        <YAxis {...AXIS} width={48} />
        <ReferenceLine y={0} stroke="#2b3a4c" />
        <Tooltip {...TT} formatter={(v) => Number(v).toFixed(2)} />
        <Bar dataKey="profit" name="Profit" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.profit >= 0 ? "#22c55e" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CalibrationChart({ data, height = 240 }: { data: { meanForecast: number; observedRate: number; count: number }[]; height?: number }) {
  const pts = data.filter((d) => d.count > 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={pts} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis type="number" dataKey="meanForecast" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
        <YAxis type="number" dataKey="observedRate" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={44} />
        <Tooltip {...TT} formatter={(v, n) => (n === "count" ? String(v) : `${(Number(v) * 100).toFixed(1)}%`)} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#556173" strokeDasharray="4 3" />
        <Line dataKey="observedRate" stroke="#3b82f6" dot={false} isAnimationActive={false} />
        <Scatter dataKey="observedRate" fill="#3b82f6" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
