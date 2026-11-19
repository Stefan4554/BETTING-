"use client";
import { useMemo, useState } from "react";
import type { Match } from "@/lib/domain";
import { fmtOdds, fmtTime, SURFACE_LABEL, TOUR_LABEL } from "@/lib/format";
import { MatchLabel, ScoreLine, SourceTag, StatusPill, EmptyState, ProbBar } from "./primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";

export interface MatchRow {
  match: Match;
  bestA: number | null;
  bestB: number | null;
  modelA: number | null;
}

/** Filterable match list used by Live, Upcoming and Tennis Analytics pages. */
export function MatchTable({ rows, showScore = true, emptyTitle = "No matches" }: { rows: MatchRow[]; showScore?: boolean; emptyTitle?: string }) {
  const [tournament, setTournament] = useState("");
  const [surface, setSurface] = useState("");
  const [tour, setTour] = useState("");
  const [status, setStatus] = useState("");
  const [country, setCountry] = useState("");
  const [bestOf, setBestOf] = useState("");
  const [maxRank, setMaxRank] = useState("");

  const opts = useMemo(() => {
    const u = <T,>(xs: T[]) => [...new Set(xs)].filter(Boolean).sort() as T[];
    return {
      tournaments: u(rows.map((r) => r.match.tournament.name)),
      surfaces: u(rows.map((r) => r.match.surface)),
      tours: u(rows.map((r) => r.match.tournament.tour)),
      statuses: u(rows.map((r) => r.match.status)),
      countries: u(rows.flatMap((r) => [r.match.playerA.countryCode ?? "", r.match.playerB.countryCode ?? ""])),
    };
  }, [rows]);

  const filtered = rows.filter(({ match: m }) => {
    if (tournament && m.tournament.name !== tournament) return false;
    if (surface && m.surface !== surface) return false;
    if (tour && m.tournament.tour !== tour) return false;
    if (status && m.status !== status) return false;
    if (country && m.playerA.countryCode !== country && m.playerB.countryCode !== country) return false;
    if (bestOf && String(m.bestOf) !== bestOf) return false;
    if (maxRank) {
      const n = Number(maxRank);
      const best = Math.min(m.playerA.rank ?? Infinity, m.playerB.rank ?? Infinity);
      if (!(best <= n)) return false;
    }
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
        <Select value={tournament} onChange={(e) => setTournament(e.target.value)}><option value="">All tournaments</option>{opts.tournaments.map((t) => <option key={t}>{t}</option>)}</Select>
        <Select value={tour} onChange={(e) => setTour(e.target.value)}><option value="">All levels</option>{opts.tours.map((t) => <option key={t} value={t}>{TOUR_LABEL[t] ?? t}</option>)}</Select>
        <Select value={surface} onChange={(e) => setSurface(e.target.value)}><option value="">All surfaces</option>{opts.surfaces.map((s) => <option key={s} value={s}>{SURFACE_LABEL[s] ?? s}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{opts.statuses.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{opts.countries.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select value={bestOf} onChange={(e) => setBestOf(e.target.value)}><option value="">Bo3 / Bo5</option><option value="3">Best of 3</option><option value="5">Best of 5</option></Select>
        <Input className="w-28" placeholder="Rank ≤" inputMode="numeric" value={maxRank} onChange={(e) => setMaxRank(e.target.value.replace(/\D/g, ""))} />
        <span className="ml-auto text-[11px] text-dim">{filtered.length} / {rows.length}</span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="info" title={emptyTitle} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Time</TH><TH>Match</TH><TH>Tournament</TH><TH>Level</TH><TH>Surface</TH><TH>Fmt</TH><TH>Status</TH>
              {showScore && <TH>Score</TH>}
              <TH className="text-right">Best A</TH><TH className="text-right">Best B</TH><TH>Model A / B</TH><TH>Source</TH>
            </TR>
          </THead>
          <tbody>
            {filtered.map(({ match: m, bestA, bestB, modelA }) => (
              <TR key={m.id}>
                <TD className="num text-muted">{fmtTime(m.scheduledAt)}</TD>
                <TD className="max-w-60"><MatchLabel m={m} /></TD>
                <TD className="max-w-48 truncate text-muted">{m.tournament.name}{m.round ? ` · ${m.round}` : ""}</TD>
                <TD className="text-muted">{TOUR_LABEL[m.tournament.tour]}</TD>
                <TD className="text-muted">{SURFACE_LABEL[m.surface]}</TD>
                <TD className="num text-muted">{m.bestOf ? `Bo${m.bestOf}` : "—"}</TD>
                <TD><StatusPill status={m.status} /></TD>
                {showScore && <TD><ScoreLine score={m.score} /></TD>}
                <TD className="num text-right">{fmtOdds(bestA)}</TD>
                <TD className="num text-right">{fmtOdds(bestB)}</TD>
                <TD><ProbBar a={modelA} /></TD>
                <TD><SourceTag provider={m.source.provider} at={m.source.updatedAt ?? m.source.fetchedAt} /></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
