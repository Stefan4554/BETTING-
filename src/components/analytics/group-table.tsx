"use client";
import * as React from "react";
import type { GroupRow } from "@/lib/finance/metrics";
import { Money } from "@/components/app/primitives";
import { fmtNum, fmtOdds, fmtPct, fmtPp } from "@/lib/format";
import { cn } from "@/lib/utils";

type Col = "bets" | "settled" | "stake" | "profit" | "roi" | "winRate" | "averageOdds" | "averageClv" | "maxDrawdown";

export function GroupTable({ rows, ccy, label = "Group", convention = "odds", cols = ["bets", "stake", "profit", "roi", "winRate", "averageOdds", "averageClv"] }: {
  rows: GroupRow[]; ccy: string; label?: string; convention?: "odds" | "probability"; cols?: Col[];
}) {
  const [sort, setSort] = React.useState<{ k: Col | "key"; desc: boolean }>({ k: "profit", desc: true });
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort.k] as number | string | null, y = b[sort.k] as number | string | null;
    if (x == null) return 1; if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
  });
  const head: Record<Col, string> = { bets: "Bets", settled: "Settled", stake: "Stake", profit: "P/L", roi: "ROI", winRate: "Win %", averageOdds: "Avg odds", averageClv: "CLV", maxDrawdown: "Max DD" };
  const H = ({ k, children }: { k: Col | "key"; children: React.ReactNode }) => (
    <th className="label-xs h-7 px-2 text-left"><button className="hover:text-fg" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : true }))}>{children}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-panel-2"><tr><H k="key">{label}</H>{cols.map((c) => <H key={c} k={c}>{head[c]}</H>)}</tr></thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-line/60 hover:bg-raised/50">
              <td className="h-7 max-w-[220px] truncate px-2">{r.key}</td>
              {cols.map((c) => (
                <td key={c} className="num px-2">
                  {c === "stake" || c === "maxDrawdown" ? <Money value={c === "maxDrawdown" ? -r[c] : r[c]} ccy={ccy} /> :
                    c === "profit" ? <Money value={r.profit} ccy={ccy} signed /> :
                      c === "roi" ? <span className={cn(r.roi != null && r.roi > 0 && "text-up", r.roi != null && r.roi < 0 && "text-down")}>{fmtPct(r.roi, 1, true)}</span> :
                        c === "winRate" ? fmtPct(r.winRate) : c === "averageOdds" ? fmtOdds(r.averageOdds) :
                          c === "averageClv" ? <span title={`n=${r.clvSample}`}>{convention === "odds" ? fmtPct(r.averageClv, 1, true) : fmtPp(r.averageClv, 1)}<span className="text-dim"> ({r.clvSample})</span></span> :
                            fmtNum(r[c] as number)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length + 1} className="py-6 text-center text-dim">No data</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
