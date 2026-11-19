"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ValueOpportunity } from "@/lib/engine/value";
import { passesThresholds } from "@/lib/engine/value";
import { fmtAgo, fmtMoney, fmtOdds, fmtPct, MARKET_LABEL } from "@/lib/format";
import { EmptyState, Panel } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { useSettings, useSort } from "@/components/portfolio/hooks";
import { cn } from "@/lib/utils";

export function ValueBoard({ initial }: { initial: ValueOpportunity[] }) {
  const [s, update] = useSettings();
  const [showAll, setShowAll] = useState(false);
  const params = new URLSearchParams({
    fraction: String(s.kellyFraction), maxStakePct: String(s.maxStakePct), modelConfidence: String(s.modelConfidence),
    minEdge: String(s.minEdge), minDataQuality: String(s.minDataQuality), maxDivergence: String(s.maxDivergence),
  });
  const q = useQuery({
    queryKey: ["value", params.toString()],
    queryFn: async () => (await (await fetch(`/api/value?${params}`)).json()) as { opportunities: ValueOpportunity[] },
    placeholderData: { opportunities: initial },
    refetchInterval: 60_000,
  });
  const all = q.data?.opportunities ?? [];
  const cfg = { fraction: s.kellyFraction, maxStakePct: s.maxStakePct, modelConfidence: s.modelConfidence, minEdge: s.minEdge, minDataQuality: s.minDataQuality, maxDivergence: s.maxDivergence };
  const rows = showAll ? all : all.filter((v) => passesThresholds(v, cfg));
  const { sorted, toggle, key, dir } = useSort(rows, "expectedValue");

  const num = (k: keyof typeof s, label: string, step: number, min: number, max: number, pct = true) => (
    <Label>
      {label}
      <Input type="number" step={step} min={min} max={max} value={pct ? +(Number(s[k]) * 100).toFixed(2) : Number(s[k])}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update({ [k]: pct ? v / 100 : v } as never); }} className="w-24" />
    </Label>
  );
  const cols: [keyof ValueOpportunity, string][] = [
    ["matchLabel", "Match"], ["market", "Market"], ["selectionLabel", "Selection"], ["bestOdds", "Best odds"], ["fairOdds", "Fair odds"],
    ["modelProbability", "Model p"], ["marketProbability", "Market p"], ["bookmakerImpliedProbability", "Book implied"], ["edgePct", "Edge"], ["expectedValue", "EV"],
    ["evLowerBound", "EV (low)"], ["kellyStakePct", "Stake"], ["confidence", "Conf."], ["dataQuality", "Data q."], ["oddsTimestamp", "Odds time"],
  ];
  return (
    <>
      <Panel title="Model & staking parameters" subtitle="saved in this browser" bodyClassName="flex flex-wrap items-end gap-3 p-3">
        {num("bankroll", "Bankroll", 50, 0, 1e9, false)}
        {num("kellyFraction", "Kelly fraction %", 5, 1, 100)}
        {num("maxStakePct", "Max stake % bank", 0.5, 0.1, 100)}
        {num("modelConfidence", "Model confidence %", 5, 0, 100)}
        {num("minEdge", "Min EV %", 0.5, -100, 100)}
        {num("minDataQuality", "Min data quality %", 5, 0, 100)}
        {num("maxDivergence", "Suspect if |model−market| > %", 1, 1, 100)}
        <label className="flex items-center gap-1 pb-1 text-xs text-muted"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show all priced selections (incl. negative EV & suspect)</label>
        <span className="pb-1 text-[11px] text-dim">{q.isFetching ? "recalculating…" : `${rows.length} shown / ${all.length} evaluated`}</span>
      </Panel>
      <Panel title="Value bets">
        {sorted.length === 0 ? (
          <EmptyState title="No selections pass the thresholds">Selections without a model probability (insufficient history) are never shown with a made-up number.</EmptyState>
        ) : (
          <Table>
            <THead><TR>{cols.map(([k, l]) => <TH key={k} onClick={() => toggle(k)} className="cursor-pointer select-none hover:text-fg">{l}{key === k ? (dir === "asc" ? " ↑" : " ↓") : ""}</TH>)}<TH>Flags</TH></TR></THead>
            <tbody>
              {sorted.map((v) => (
                <TR key={v.matchId + v.market + v.selection} className={cn(v.suspect && "opacity-60")}>
                  <TD className="max-w-56 truncate"><Link href={`/matches/${encodeURIComponent(v.matchId)}`} className="hover:text-accent">{v.matchLabel}</Link></TD>
                  <TD className="text-muted">{MARKET_LABEL[v.market] ?? v.market}</TD>
                  <TD>{v.selectionLabel}<div className="text-[10.5px] text-dim">{v.bestBookmaker}</div></TD>
                  <TD className="num font-semibold">{fmtOdds(v.bestOdds)}</TD>
                  <TD className="num text-muted">{fmtOdds(v.fairOdds)}</TD>
                  <TD className="num">{fmtPct(v.modelProbability)}</TD>
                  <TD className="num text-accent">{fmtPct(v.marketProbability)}</TD>
                  <TD className="num text-muted">{fmtPct(v.bookmakerImpliedProbability)}</TD>
                  <TD className={cn("num", v.edgePct > 0 ? "text-up" : "text-down")}>{fmtPct(v.edgePct, 1, true)}</TD>
                  <TD className={cn("num font-semibold", v.expectedValue > 0 ? "text-up" : "text-down")}>{fmtPct(v.expectedValue, 1, true)}</TD>
                  <TD className={cn("num", (v.evLowerBound ?? 0) > 0 ? "text-up" : "text-down")}>{fmtPct(v.evLowerBound, 1, true)}</TD>
                  <TD className="num">{fmtPct(v.kellyStakePct, 2)}<div className="text-[10.5px] text-dim">{fmtMoney(s.bankroll * v.kellyStakePct, s.currency)}{v.kellyCapped ? " · capped" : ""}</div></TD>
                  <TD><Badge tone={v.confidence === "high" ? "up" : v.confidence === "medium" ? "accent" : "warn"}>{v.confidence}</Badge></TD>
                  <TD className="num">{fmtPct(v.dataQuality, 0)}</TD>
                  <TD className="num text-muted" title={v.oddsTimestamp}>{fmtAgo(v.oddsTimestamp)}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {v.suspect && <Badge tone="down">suspect</Badge>}
                      {v.warnings.length > 0 && <span title={v.warnings.join("\n")}><Badge tone="warn">⚠ {v.warnings.length}</Badge></span>}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
