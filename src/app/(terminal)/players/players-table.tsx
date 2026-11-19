"use client";
import Link from "next/link";
import { useState } from "react";
import type { Player } from "@/lib/domain";
import { fmtPct, TOUR_LABEL } from "@/lib/format";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Missing } from "@/components/terminal/primitives";
import { useSort } from "@/components/portfolio/hooks";

export type PlayerRow = Player & { elo: number | null; matches: number | null; winPct: number | null; last10: string | null; holdPct: number | null; breakPct: number | null };

export function PlayersTable({ rows }: { rows: PlayerRow[] }) {
  const [q, setQ] = useState("");
  const [tour, setTour] = useState("");
  const [country, setCountry] = useState("");
  const countries = [...new Set(rows.map((r) => r.countryCode).filter(Boolean))].sort() as string[];
  const f = rows.filter((r) => (!q || r.name.toLowerCase().includes(q.toLowerCase())) && (!tour || r.tour === tour) && (!country || r.countryCode === country));
  const { sorted, toggle, key, dir } = useSort(f, "rank", "asc");
  const cols: [keyof PlayerRow, string][] = [["rank", "Rank"], ["name", "Player"], ["tour", "Tour"], ["countryCode", "Ctry"], ["rankingPoints", "Points"], ["birthDate", "Born"], ["handedness", "Plays"], ["heightCm", "Ht"], ["elo", "Elo"], ["matches", "Matches"], ["winPct", "Win %"], ["last10", "Last 10"], ["holdPct", "Hold %"], ["breakPct", "Break %"]];
  const v = (x: unknown) => (x == null ? <Missing /> : String(x));
  return (
    <>
      <div className="flex flex-wrap gap-1.5 border-b border-line p-2">
        <Input placeholder="Search name" value={q} onChange={(e) => setQ(e.target.value)} className="w-52" />
        <Select value={tour} onChange={(e) => setTour(e.target.value)}><option value="">All tours</option><option value="atp">ATP</option><option value="wta">WTA</option></Select>
        <Select value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{countries.map((c) => <option key={c}>{c}</option>)}</Select>
      </div>
      <Table>
        <THead><TR>{cols.map(([k, l]) => <TH key={k} onClick={() => toggle(k)} className="cursor-pointer select-none hover:text-fg">{l}{key === k ? (dir === "asc" ? " ↑" : " ↓") : ""}</TH>)}</TR></THead>
        <tbody>
          {sorted.map((p) => (
            <TR key={p.id}>
              <TD className="num">{v(p.rank)}</TD>
              <TD><Link href={`/players/${encodeURIComponent(p.id)}`} className="hover:text-accent">{p.name}</Link></TD>
              <TD className="text-muted">{p.tour ? TOUR_LABEL[p.tour] : <Missing />}</TD>
              <TD>{v(p.countryCode)}</TD>
              <TD className="num">{p.rankingPoints?.toLocaleString() ?? <Missing />}</TD>
              <TD className="num text-muted">{v(p.birthDate)}</TD>
              <TD>{v(p.handedness)}</TD>
              <TD className="num">{v(p.heightCm)}</TD>
              <TD className="num text-accent">{v(p.elo)}</TD>
              <TD className="num">{v(p.matches)}</TD>
              <TD className="num">{fmtPct(p.winPct, 0)}</TD>
              <TD className="num">{v(p.last10)}</TD>
              <TD className="num">{fmtPct(p.holdPct, 0)}</TD>
              <TD className="num">{fmtPct(p.breakPct, 0)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </>
  );
}
