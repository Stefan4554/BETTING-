"use client";
import { useMemo, useState } from "react";
import type { ComparisonRow } from "@/lib/data/board";
import { fmtAgo, fmtOdds, MARKET_LABEL } from "@/lib/format";
import { Delta, EmptyState, Panel, SourceTag } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Select } from "@/components/ui/input";
import { useSort } from "@/components/portfolio/hooks";
import { cn } from "@/lib/utils";

const COLS: [keyof ComparisonRow, string, boolean?][] = [
  ["bookmakerName", "Bookmaker"], ["matchLabel", "Match"], ["market", "Market"], ["selectionLabel", "Selection"],
  ["currentOdds", "Current", true], ["openingOdds", "Opening", true], ["bestAvailable", "Best avail.", true], ["movementPct", "Move", true], ["lastUpdate", "Last update"],
];

export function ComparisonTable({ rows, initialMatch }: { rows: ComparisonRow[]; initialMatch: string }) {
  const [book, setBook] = useState("");
  const [market, setMarket] = useState("match_winner");
  const [match, setMatch] = useState(initialMatch);
  const [bestOnly, setBestOnly] = useState(false);
  const books = useMemo(() => [...new Map(rows.map((r) => [r.bookmaker, r.bookmakerName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const matches = useMemo(() => [...new Map(rows.map((r) => [r.matchId, r.matchLabel])).entries()], [rows]);
  const markets = useMemo(() => [...new Set(rows.map((r) => r.market))], [rows]);
  const filtered = rows.filter((r) => (!book || r.bookmaker === book) && (!market || r.market === market) && (!match || r.matchId === match) && (!bestOnly || r.isBest));
  const { sorted, key, dir, toggle } = useSort(filtered, "matchLabel", "asc");

  return (
    <Panel
      title="Comparison"
      subtitle={`${filtered.length} prices`}
      actions={
        <>
          <Select value={match} onChange={(e) => setMatch(e.target.value)}><option value="">All matches</option>{matches.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</Select>
          <Select value={market} onChange={(e) => setMarket(e.target.value)}><option value="">All markets</option>{markets.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}</Select>
          <Select value={book} onChange={(e) => setBook(e.target.value)}><option value="">All bookmakers</option>{books.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>
          <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} /> best only</label>
        </>
      }
    >
      {sorted.length === 0 ? <EmptyState title="No prices for these filters" /> : (
        <Table>
          <THead>
            <TR>
              {COLS.map(([k, l, right]) => (
                <TH key={k} className={cn("cursor-pointer select-none hover:text-fg", right && "text-right")} onClick={() => toggle(k)}>
                  {l}{key === k ? (dir === "asc" ? " ↑" : " ↓") : ""}
                </TH>
              ))}
              <TH>Source</TH>
            </TR>
          </THead>
          <tbody>
            {sorted.slice(0, 1500).map((r, i) => (
              <TR key={i} className={r.isBest ? "bg-up-soft/30" : ""}>
                <TD>{r.bookmakerName}</TD>
                <TD className="max-w-56 truncate text-muted">{r.matchLabel}</TD>
                <TD className="text-muted">{MARKET_LABEL[r.market]}{r.line != null ? ` ${r.line}` : ""}</TD>
                <TD className="max-w-48 truncate">{r.selectionLabel}</TD>
                <TD className={cn("num text-right", r.isBest && "font-semibold text-up")}>{fmtOdds(r.currentOdds)}</TD>
                <TD className="num text-right text-muted">{fmtOdds(r.openingOdds)}</TD>
                <TD className="num text-right">{fmtOdds(r.bestAvailable)}</TD>
                <TD className="text-right"><Delta value={r.movementPct} /></TD>
                <TD className="num text-muted" title={r.lastUpdate}>{fmtAgo(r.lastUpdate)}</TD>
                <TD><SourceTag provider={r.provider} /></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
