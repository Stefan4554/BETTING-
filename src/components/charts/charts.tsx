"use client";
/**
 * Chart kit. Colour by job: series identity uses the validated categorical order
 * (--s1…--s8, fixed order, never cycled); P/L polarity uses up/down tokens with the sign
 * also visible in the tooltip and axis. One y-axis per chart. Every chart has a hover layer.
 */
import * as React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtCompactMoney, fmtMoney, fmtNum, fmtOdds, fmtPct, fmtPp } from "@/lib/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rows = readonly any[];
export type ValueFormat = "money" | "pct" | "pp" | "num" | "odds" | "int";
export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

export function fmtValue(v: unknown, f: ValueFormat, ccy = "EUR", compact = false): string {
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  switch (f) {
    case "money": return compact ? fmtCompactMoney(n, ccy) : fmtMoney(n, ccy);
    case "pct": return fmtPct(n, 1);
    case "pp": return fmtPp(n, 1);
    case "odds": return fmtOdds(n);
    case "int": return fmtNum(n, 0);
    default: return fmtNum(n, 2);
  }
}

const axis = { stroke: "var(--line-strong)", tick: { fill: "var(--muted)", fontSize: 10.5 }, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />;

function shortDate(v: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  if (/^\d{4}-\d{2}$/.test(v)) return new Date(v + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  return v;
}

function TooltipBox({ active, payload, label, format, ccy, labelFormat }: {
  active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];
  label?: string; format: ValueFormat; ccy: string; labelFormat?: "date" | "raw";
}) {
  if (!active || !payload?.length) return null;
  const extra = payload[0]?.payload?.__extra as string | undefined;
  return (
    <div className="rounded-[3px] border border-line-strong bg-raised px-2 py-1.5 text-[11px] shadow-lg">
      <div className="mb-0.5 text-muted">{labelFormat === "raw" ? label : shortDate(String(label ?? ""))}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ml-auto text-fg">{fmtValue(p.value, format, ccy)}</span>
        </div>
      ))}
      {extra && <div className="mt-0.5 text-dim">{extra}</div>}
    </div>
  );
}

function NoData({ height }: { height: number }) {
  return <div className="grid place-items-center text-xs text-dim" style={{ height }}>No data for this period</div>;
}

export interface SeriesDef { key: string; name: string; color?: string }

/** Time series (line or area). Area only for a single cumulative series. */
export function TimeSeries({ data, xKey = "at", series, format = "money", ccy = "EUR", height = 220, area = false, zeroLine = true }: {
  data: Rows; xKey?: string; series: SeriesDef[]; format?: ValueFormat; ccy?: string; height?: number; area?: boolean; zeroLine?: boolean;
}) {
  if (!data.length) return <NoData height={height} />;
  const yFmt = (v: number) => fmtValue(v, format, ccy, true);
  if (area && series.length === 1) {
    const s = series[0]!;
    const last = Number(data.at(-1)?.[s.key] ?? 0);
    const color = s.color ?? (last >= 0 ? "var(--up)" : "var(--down)");
    const gid = `g-${s.key}`;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
          {grid}
          <XAxis dataKey={xKey} {...axis} tickFormatter={shortDate} minTickGap={40} />
          <YAxis {...axis} width={62} tickFormatter={yFmt} />
          {zeroLine && <ReferenceLine y={0} stroke="var(--line-strong)" />}
          <Tooltip content={<TooltipBox format={format} ccy={ccy} />} cursor={{ stroke: "var(--line-strong)" }} />
          <Area type="monotone" dataKey={s.key} name={s.name} stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)" }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey={xKey} {...axis} tickFormatter={shortDate} minTickGap={40} />
        <YAxis {...axis} width={62} tickFormatter={yFmt} domain={zeroLine ? undefined : ["auto", "auto"]} />
        {zeroLine && <ReferenceLine y={0} stroke="var(--line-strong)" />}
        <Tooltip content={<TooltipBox format={format} ccy={ccy} />} cursor={{ stroke: "var(--line-strong)" }} />
        {series.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? SERIES[i]} strokeWidth={2} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)" }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Signed bars over time (daily/weekly/monthly P/L). Green above zero, red below. */
export function SignedBars({ data, xKey, yKey, name, format = "money", ccy = "EUR", height = 200, labelFormat = "date" }: {
  data: Rows; xKey: string; yKey: string; name: string; format?: ValueFormat; ccy?: string; height?: number; labelFormat?: "date" | "raw";
}) {
  if (!data.length) return <NoData height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={2}>
        {grid}
        <XAxis dataKey={xKey} {...axis} tickFormatter={labelFormat === "date" ? shortDate : undefined} minTickGap={20} />
        <YAxis {...axis} width={62} tickFormatter={(v: number) => fmtValue(v, format, ccy, true)} />
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        <Tooltip content={<TooltipBox format={format} ccy={ccy} labelFormat={labelFormat} />} cursor={{ fill: "var(--raised)" }} />
        <Bar dataKey={yKey} name={name} radius={[3, 3, 3, 3]} maxBarSize={28} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={Number(d[yKey]) >= 0 ? "var(--up)" : "var(--down)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for category comparisons (profit by sport, CLV by bookmaker …). */
export function CategoryBars({ data, labelKey = "key", valueKey, name, format = "money", ccy = "EUR", signed = true, height, color }: {
  data: Rows; labelKey?: string; valueKey: string; name: string; format?: ValueFormat; ccy?: string; signed?: boolean; height?: number; color?: string;
}) {
  const h = height ?? Math.max(120, data.length * 26 + 30);
  if (!data.length) return <NoData height={120} />;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barCategoryGap={4}>
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v: number) => fmtValue(v, format, ccy, true)} />
        <YAxis type="category" dataKey={labelKey} {...axis} width={110} tick={{ fill: "var(--fg)", fontSize: 11 }} />
        <ReferenceLine x={0} stroke="var(--line-strong)" />
        <Tooltip content={<TooltipBox format={format} ccy={ccy} labelFormat="raw" />} cursor={{ fill: "var(--raised)" }} />
        <Bar dataKey={valueKey} name={name} radius={[3, 3, 3, 3]} maxBarSize={16} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={color ?? (!signed ? "var(--s1)" : Number(d[valueKey]) >= 0 ? "var(--up)" : "var(--down)")} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Distribution of counts (odds / stake / CLV buckets). Single hue — magnitude, not polarity. */
export function Histogram({ data, labelKey = "key", valueKey = "count", name = "Bets", height = 180, colorBySign }: {
  data: Rows; labelKey?: string; valueKey?: string; name?: string; height?: number; colorBySign?: string;
}) {
  if (!data.length) return <NoData height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={2}>
        {grid}
        <XAxis dataKey={labelKey} {...axis} interval={0} tick={{ fill: "var(--muted)", fontSize: 10 }} />
        <YAxis {...axis} width={40} allowDecimals={false} />
        <Tooltip content={<TooltipBox format="int" ccy="EUR" labelFormat="raw" />} cursor={{ fill: "var(--raised)" }} />
        <Bar dataKey={valueKey} name={name} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={colorBySign ? (Number(d[colorBySign]) >= 0 ? "var(--up)" : "var(--down)") : "var(--s1)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Reliability diagram: predicted vs actual with 95% Wilson intervals and the perfect-calibration diagonal. */
export function ReliabilityChart({ buckets, height = 260 }: {
  buckets: { label: string; n: number; meanPredicted: number | null; actualRate: number | null; ciLow: number | null; ciHigh: number | null }[]; height?: number;
}) {
  const pts = buckets.filter((b) => b.n > 0 && b.meanPredicted != null).map((b) => ({
    x: b.meanPredicted!, y: b.actualRate!, err: [b.actualRate! - (b.ciLow ?? b.actualRate!), (b.ciHigh ?? b.actualRate!) - b.actualRate!], n: b.n, __extra: `${b.n} bets · bucket ${b.label}`,
  }));
  if (!pts.length) return <NoData height={height} />;
  const diag = [{ x: 0, d: 0 }, { x: 1, d: 1 }];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke="var(--line)" />
        <XAxis type="number" dataKey="x" domain={[0, 1]} {...axis} tickFormatter={(v: number) => fmtPct(v, 0)} name="Predicted" />
        <YAxis type="number" dataKey="y" domain={[0, 1]} {...axis} width={44} tickFormatter={(v: number) => fmtPct(v, 0)} name="Actual" />
        <Tooltip content={<TooltipBox format="pct" ccy="EUR" labelFormat="raw" />} />
        <Line data={diag} dataKey="d" stroke="var(--line-strong)" strokeDasharray="4 4" dot={false} name="Perfect calibration" isAnimationActive={false} legendType="none" />
        <Scatter data={pts} dataKey="y" name="Actual win rate" fill="var(--s1)" stroke="var(--panel)" strokeWidth={2} isAnimationActive={false}>
          <ErrorBar dataKey="err" width={4} stroke="var(--muted)" direction="y" />
        </Scatter>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Simple data table fallback for any chart (accessibility & export). */
export function ChartTable({ rows, columns }: { rows: Rows; columns: { key: string; label: string; format?: ValueFormat; ccy?: string }[] }) {
  return (
    <details className="border-t border-line px-3 py-1 text-[11px] text-muted no-print">
      <summary className="cursor-pointer select-none">Table view</summary>
      <div className="max-h-56 overflow-auto">
        <table className="w-full">
          <thead><tr>{columns.map((c) => <th key={c.key} className="label-xs px-1 py-1 text-left">{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-line/50">{columns.map((c) => <td key={c.key} className="num px-1 py-0.5">{c.format ? fmtValue(r[c.key], c.format, c.ccy) : String(r[c.key] ?? "—")}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}
