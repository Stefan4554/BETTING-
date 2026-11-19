"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OddsSnapshot, MarketKey } from "@/lib/domain";
import { historySeries } from "@/lib/data/board";
import { detectSteamMoves, direction } from "@/lib/engine/movement";
import { oddsMovementPct } from "@/lib/engine/odds";
import { fmtDateTime, fmtOdds, fmtPct, MARKET_LABEL } from "@/lib/format";
import { ConsensusChart, OddsHistoryChart } from "@/components/charts/charts";
import { Delta, EmptyState, Panel } from "@/components/terminal/primitives";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";

const PERIODS = [["1h", 3600_000], ["6h", 6 * 3600_000], ["24h", 24 * 3600_000], ["7d", 7 * 86_400_000], ["All", Infinity]] as const;

export function MovementExplorer({ matches, selectedId, history, note }: {
  matches: { id: string; label: string; a: string; b: string; start: string; status: string }[];
  selectedId: string | null; history: OddsSnapshot[]; note: string | null;
}) {
  const router = useRouter();
  const sel = matches.find((m) => m.id === selectedId);
  const marketKeys = useMemo(() => [...new Set(history.map((h) => `${h.market}|${h.line ?? ""}`))], [history]);
  const [mk, setMk] = useState(marketKeys.find((k) => k.startsWith("match_winner")) ?? marketKeys[0] ?? "match_winner|");
  const [market, lineStr] = mk.split("|") as [MarketKey, string];
  const line = lineStr === "" ? null : Number(lineStr);
  const selections = useMemo(() => [...new Map(history.filter((h) => h.market === market && (h.line ?? null) === line).map((h) => [h.selection, h.selectionLabel])).entries()], [history, market, line]);
  const [selection, setSelection] = useState("a");
  const sid = selections.find(([s]) => s === selection) ? selection : selections[0]?.[0] ?? "a";
  const [period, setPeriod] = useState<number>(24 * 3600_000);

  const now = Date.now();
  const windowed = history.filter((h) => now - Date.parse(h.capturedAt) <= period);
  const series = historySeries(windowed, market, line, sid);
  const books = [...new Map(windowed.map((p) => [p.bookmaker, { key: p.bookmaker, name: p.bookmakerName }])).values()];
  const steam = detectSteamMoves(windowed.filter((p) => p.market === market && (p.line ?? null) === line && p.selection === sid).map((p) => ({ bookmaker: p.bookmaker, odds: p.odds, at: p.capturedAt })));

  const perBook = books.map((b) => {
    const pts = windowed.filter((p) => p.bookmaker === b.key && p.market === market && (p.line ?? null) === line && p.selection === sid).sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
    const first = pts[0], last = pts.at(-1);
    const closing = sel && Date.parse(sel.start) <= now ? [...pts].reverse().find((p) => Date.parse(p.capturedAt) <= Date.parse(sel.start)) : undefined;
    return { b, open: first?.odds ?? null, cur: last?.odds ?? null, close: closing?.odds ?? null, high: pts.length ? Math.max(...pts.map((p) => p.odds)) : null, low: pts.length ? Math.min(...pts.map((p) => p.odds)) : null, n: pts.length, at: last?.capturedAt };
  });
  const first = series[0], last = series.at(-1);

  return (
    <>
      <Panel bodyClassName="flex flex-wrap items-center gap-1.5 p-2">
        <Select value={selectedId ?? ""} onChange={(e) => router.push(`/movement?match=${encodeURIComponent(e.target.value)}`)} className="max-w-80">
          {matches.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
        <Select value={mk} onChange={(e) => setMk(e.target.value)}>{marketKeys.map((k) => { const [m, l] = k.split("|"); return <option key={k} value={k}>{MARKET_LABEL[m!]}{l ? ` ${l}` : ""}</option>; })}</Select>
        <Select value={sid} onChange={(e) => setSelection(e.target.value)}>{selections.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</Select>
        <div className="ml-auto flex gap-1">
          {PERIODS.map(([l, ms]) => <button key={l} onClick={() => setPeriod(ms)} className={`h-7 rounded-[3px] border px-2 text-xs ${period === ms ? "border-accent bg-accent-soft" : "border-line-strong text-muted"}`}>{l}</button>)}
        </div>
      </Panel>

      {series.length === 0 ? <Panel><EmptyState title="No line history for this selection">{note ?? "No snapshots in the selected period."}</EmptyState></Panel> : (
        <>
          <div className="grid gap-3 xl:grid-cols-4">
            <Panel title="Summary" bodyClassName="grid grid-cols-2 gap-px bg-line">
              {[
                ["Opening best", fmtOdds(first?.best)], ["Current best", fmtOdds(last?.best)],
                ["Line move", <Delta key="m" value={first && last ? oddsMovementPct(first.best, last.best) : null} />],
                ["Direction", first && last ? <Badge key="d" tone={direction(first.best, last.best) === "shortening" ? "up" : direction(first.best, last.best) === "drifting" ? "down" : "neutral"}>{direction(first.best, last.best)}</Badge> : "—"],
                ["Consensus open", fmtPct(first?.consensus)], ["Consensus now", fmtPct(last?.consensus)],
                ["Steam moves", steam.length], ["Reverse line move", <span key="r" className="text-dim" title="Requires public betting-percentage data, which the connected providers do not supply">n/a</span>],
              ].map(([k, v]) => <div key={String(k)} className="bg-panel px-3 py-2"><div className="label-xs">{k}</div><div className="num text-sm">{v}</div></div>)}
            </Panel>
            <Panel title="Price history" subtitle="best, average and each bookmaker" className="xl:col-span-3">
              <div className="p-2"><OddsHistoryChart data={series} books={books} height={300} /></div>
            </Panel>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Market consensus (no-vig)" className="xl:col-span-2"><div className="p-2"><ConsensusChart data={series} /></div></Panel>
            <Panel title="Steam moves" subtitle="≥3 books, same direction, ≤15 min">
              {steam.length === 0 ? <EmptyState icon="info" title="None detected in this period" /> : (
                <Table><THead><TR><TH>Window</TH><TH className="text-right">Books</TH><TH className="text-right">Δ implied</TH></TR></THead>
                  <tbody>{steam.map((s) => <TR key={s.start}><TD className="num">{fmtDateTime(s.start)}</TD><TD className="num text-right">{s.booksMoved}</TD><TD className={`num text-right ${s.avgProbShift > 0 ? "text-up" : "text-down"}`}>{fmtPct(s.avgProbShift, 1, true)}</TD></TR>)}</tbody>
                </Table>
              )}
            </Panel>
          </div>
          <Panel title="By bookmaker" subtitle="closing = last pre-start price">
            <Table>
              <THead><TR><TH>Bookmaker</TH><TH className="text-right">Open</TH><TH className="text-right">Current</TH><TH className="text-right">Move</TH><TH className="text-right">High</TH><TH className="text-right">Low</TH><TH className="text-right">Closing</TH><TH className="text-right">Snapshots</TH><TH>Last</TH></TR></THead>
              <tbody>{perBook.map((r) => (
                <TR key={r.b.key}><TD>{r.b.name}</TD><TD className="num text-right text-muted">{fmtOdds(r.open)}</TD><TD className="num text-right">{fmtOdds(r.cur)}</TD><TD className="text-right"><Delta value={r.open && r.cur ? oddsMovementPct(r.open, r.cur) : null} /></TD><TD className="num text-right">{fmtOdds(r.high)}</TD><TD className="num text-right">{fmtOdds(r.low)}</TD><TD className="num text-right">{fmtOdds(r.close)}</TD><TD className="num text-right text-muted">{r.n}</TD><TD className="num text-muted">{fmtDateTime(r.at)}</TD></TR>
              ))}</tbody>
            </Table>
          </Panel>
        </>
      )}
    </>
  );
}
