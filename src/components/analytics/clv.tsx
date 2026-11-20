"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Analytics } from "@/lib/server/analytics";
import { Kpi, Notice, PageHeader, Panel, SampleWarning, toneOf } from "@/components/app/primitives";
import { CategoryBars, Histogram, TimeSeries } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { captureClosingOdds, setClosingOdds } from "@/app/actions/bets";
import { fmtDate, fmtPct, fmtPp } from "@/lib/format";

type G = { key: string; clv: number; n: number; positive: number };

export function ClvView({ a, rangeLabel, missing, reference, byLeague, byStrategy, movement }: {
  a: Analytics; rangeLabel: string; reference: string | null; byLeague: G[]; byStrategy: G[];
  missing: { id: string; ref: number; event: string; selection: string; odds: number; placed_at: string; bookmaker: string | null }[];
  movement: { id: string; opening: number | null; taken: number; closing: number | null }[];
}) {
  const router = useRouter();
  const conv = a.convention;
  const fmt = (v: number | null) => (conv === "odds" ? fmtPct(v, 2, true) : fmtPp(v));
  const pts = a.clvPoints;
  const pos = pts.filter((p) => p.clv > 0).length, neg = pts.filter((p) => p.clv < 0).length, flat = pts.length - pos - neg;
  const group = (k: "sport" | "bookmaker" | "market") => {
    const m = new Map<string, number[]>();
    for (const p of pts) { const key = (p[k] ?? "—") as string; (m.get(key) ?? m.set(key, []).get(key)!).push(p.clv); }
    return [...m.entries()].map(([key, v]) => ({ key, clv: v.reduce((x, y) => x + y, 0) / v.length, n: v.length })).sort((x, y) => y.clv - x.clv);
  };
  const step = conv === "odds" ? 0.02 : 0.01;
  const dist = React.useMemo(() => {
    const b = new Map<number, number>();
    for (const p of pts) { const k = Math.max(-6, Math.min(6, Math.floor(p.clv / step))); b.set(k, (b.get(k) ?? 0) + 1); }
    return Array.from({ length: 13 }, (_, i) => i - 6).map((k) => ({ key: k === -6 ? `≤${fmt(-6 * step)}` : k === 6 ? `≥${fmt(6 * step)}` : fmt(k * step), count: b.get(k) ?? 0, sign: k }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, conv]);
  const moved = movement.filter((m) => m.opening && m.closing);
  const shortened = moved.filter((m) => m.closing! < m.opening!).length;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="CLV Intelligence" description={`${rangeLabel} · convention: ${conv === "odds" ? "odds-based — taken / closing − 1" : "probability-based — closing implied − entry implied (pp)"} · reference market: ${reference ?? "each bet's own bookmaker"}`}
        actions={<>
          <Link href="/settings?tab=general" className="text-[11px] text-accent">Change convention / reference</Link>
          <Button variant="outline" onClick={async () => { const r = await captureClosingOdds(); if (!r.ok) toast.error(r.error); else { toast.success(`${r.data} closing prices captured from stored snapshots`); router.refresh(); } }}>Capture from snapshots</Button>
        </>} />
      <SampleWarning n={a.summary.clvSample} what="bets with closing odds" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Average CLV" value={fmt(a.summary.averageClv)} tone={toneOf(a.summary.averageClv)} sub={`n=${a.summary.clvSample}`} />
        <Kpi label="Beat the close" value={fmtPct(a.summary.positiveClvRate)} sub={`${pos} positive`} />
        <Kpi label="Negative CLV" value={String(neg)} sub={`${flat} unchanged`} />
        <Kpi label="Missing closing odds" value={String(missing.length)} sub="settled singles" tone={missing.length ? "warn" : "neutral"} />
        <Kpi label="Markets shortened" value={moved.length ? fmtPct(shortened / moved.length) : "—"} sub={`open→close, n=${moved.length}`} />
        <Kpi label="ROI (same period)" value={fmtPct(a.summary.roi, 2, true)} tone={toneOf(a.summary.roi)} sub="for comparison" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="CLV trend" subtitle="running average"><TimeSeries data={a.curve.filter((x) => x.clv != null)} series={[{ key: "clv", name: "Avg CLV", color: "var(--s3)" }]} format={conv === "odds" ? "pct" : "pp"} /></Panel>
        <Panel title="CLV distribution" subtitle="positive vs negative"><Histogram data={dist} colorBySign="sign" /></Panel>
        <Panel title="Average CLV by sport"><CategoryBars data={group("sport")} valueKey="clv" name="Avg CLV" format={conv === "odds" ? "pct" : "pp"} /></Panel>
        <Panel title="Average CLV by bookmaker"><CategoryBars data={group("bookmaker")} valueKey="clv" name="Avg CLV" format={conv === "odds" ? "pct" : "pp"} /></Panel>
        <Panel title="Average CLV by market"><CategoryBars data={group("market")} valueKey="clv" name="Avg CLV" format={conv === "odds" ? "pct" : "pp"} /></Panel>
        <Panel title="Average CLV by strategy"><CategoryBars data={byStrategy} valueKey="clv" name="Avg CLV" format={conv === "odds" ? "pct" : "pp"} /></Panel>
        <Panel title="Average CLV by league"><CategoryBars data={byLeague.slice(0, 15)} valueKey="clv" name="Avg CLV" format={conv === "odds" ? "pct" : "pp"} /></Panel>
      </div>
      <Panel title="Settled bets without closing odds" subtitle="enter manually, or link bets to stored markets for automatic capture">
        {missing.length === 0 ? <p className="p-4 text-xs text-dim">All settled singles have a closing price.</p> : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-2"><tr>{["#", "Placed", "Event", "Selection", "Book", "Taken", "Closing odds"].map((h) => <th key={h} className="label-xs h-7 px-2 text-left">{h}</th>)}</tr></thead>
              <tbody>{missing.map((m) => <MissingRow key={m.id} m={m} />)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <Notice>Automatic capture copies the last pre-start snapshot from the reference bookmaker (or the bet&apos;s own bookmaker) for bets linked to an ingested market. Bets entered manually without a market link need a manual closing price.</Notice>
    </div>
  );
}

function MissingRow({ m }: { m: { id: string; ref: number; event: string; selection: string; odds: number; placed_at: string; bookmaker: string | null } }) {
  const router = useRouter();
  const [v, setV] = React.useState("");
  const save = async () => {
    const n = Number(v.replace(",", "."));
    if (!(n > 1)) return toast.error("Odds must be > 1");
    const r = await setClosingOdds(m.id, n);
    if (!r.ok) toast.error(r.error); else { toast.success(`Closing odds saved for #${m.ref}`); router.refresh(); }
  };
  return (
    <tr className="border-b border-line/60">
      <td className="num h-8 px-2 text-dim">{m.ref}</td><td className="num px-2">{fmtDate(m.placed_at)}</td><td className="px-2">{m.event}</td>
      <td className="px-2">{m.selection}</td><td className="px-2 text-muted">{m.bookmaker ?? "—"}</td><td className="num px-2">{m.odds.toFixed(2)}</td>
      <td className="px-2"><div className="flex gap-1"><Input className="h-6 w-20" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} /><Button size="sm" variant="outline" onClick={save}>Save</Button></div></td>
    </tr>
  );
}
