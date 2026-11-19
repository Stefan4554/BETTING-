import Link from "next/link";
import { notFound } from "next/navigation";
import { getHeadToHead, getMarketRows, getMatch, getMomentum, getOddsHistory, getPlayer, getPredictions, getStats } from "@/lib/data/service";
import { historySeries } from "@/lib/data/board";
import type { Player, PlayerMatchStats } from "@/lib/domain";
import type { PlayerAnalytics, WL } from "@/lib/engine/player-analytics";
import { fmtDateTime, fmtOdds, fmtPct, MARKET_LABEL, ratio, SURFACE_LABEL, TOUR_LABEL } from "@/lib/format";
import { Delta, EmptyState, Missing, Panel, ProbBar, ScoreLine, SourceTag, StatusPill } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MomentumChart, OddsHistoryChart } from "@/components/charts/charts";
import { calibrateServe, liveWinProb } from "@/lib/engine/live-prob";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const match = await getMatch(id);
  if (!match) notFound();
  const [markets, stats, history, preds, pa, pb, h2h] = await Promise.all([
    getMarketRows(id), getStats(id), getOddsHistory(id), getPredictions(),
    getPlayer(match.playerA.id), getPlayer(match.playerB.id), getHeadToHead(match.playerA.id, match.playerB.id),
  ]);
  const pred = preds.find((p) => p.matchId === id);
  const momentum = getMomentum(id);
  const series = historySeries(history.points, "match_winner", null, "a");
  const books = [...new Map(history.points.map((p) => [p.bookmaker, { key: p.bookmaker, name: p.bookmakerName }])).values()];
  let liveA: number | null = null;
  if (pred?.prediction && match.score && match.bestOf && match.status === "live") {
    const s = calibrateServe(pred.prediction.probA, match.bestOf, match.playerA.tour === "wta" ? 0.56 : 0.64);
    liveA = liveWinProb(s.pa, s.pb, { bestOf: match.bestOf, ...match.score });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link href="/analytics" className="hover:text-fg">Tennis</Link> / <span>{match.tournament.name}</span>
        <Badge>{TOUR_LABEL[match.tournament.tour]}</Badge><Badge>{SURFACE_LABEL[match.surface]}</Badge>
        {match.bestOf && <Badge>Best of {match.bestOf}</Badge>}
        {match.round && <Badge>{match.round}</Badge>}
        <StatusPill status={match.status} />
        <span className="num">{fmtDateTime(match.scheduledAt)}</span>
        <SourceTag provider={match.source.provider} at={match.source.updatedAt ?? match.source.fetchedAt} className="ml-auto" />
      </div>

      <Panel bodyClassName="grid gap-4 p-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <PlayerHead p={match.playerA} winner={match.winner === "a"} serving={match.score?.server === "a"} />
        <div className="flex flex-col items-center gap-2">
          <ScoreLine score={match.score} className="text-lg" />
          <div className="text-center">
            <div className="label-xs">{liveA != null ? "Live win probability" : "Pre-match model"}</div>
            <ProbBar a={liveA ?? pred?.prediction?.probA ?? null} />
            {pred?.prediction && (
              <div className="num mt-0.5 text-[10.5px] text-dim">≈90% interval {fmtPct(pred.prediction.ciLow, 0)}–{fmtPct(pred.prediction.ciHigh, 0)}</div>
            )}
            {!pred?.prediction && <div className="mt-0.5 max-w-56 text-[10.5px] text-dim">{pred?.reason}</div>}
          </div>
        </div>
        <PlayerHead p={match.playerB} winner={match.winner === "b"} serving={match.score?.server === "b"} right />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Match statistics" subtitle={stats ? undefined : "not available"} className="xl:col-span-1">
          {stats ? <StatsTable a={stats.a} b={stats.b} /> : <EmptyState icon="info" title="No statistics from the data source for this match" />}
          {stats && <div className="border-t border-line px-3 py-1"><SourceTag provider={stats.source.provider} at={stats.source.updatedAt ?? stats.source.fetchedAt} /></div>}
        </Panel>
        <Panel title="Head-to-head" subtitle={h2h ? `${h2h.aWins}–${h2h.bWins}` : undefined}>
          {!h2h || h2h.meetings.length === 0 ? <EmptyState icon="info" title="No previous meetings in stored history" /> : (
            <>
              <div className="flex gap-3 border-b border-line px-3 py-2 text-xs">
                {Object.entries(h2h.bySurface).map(([s, v]) => <span key={s}><span className="text-muted">{SURFACE_LABEL[s]}</span> <span className="num">{v.aWins}–{v.bWins}</span></span>)}
              </div>
              <Table><tbody>{h2h.meetings.map((m) => (
                <TR key={m.id}><TD className="num text-muted">{m.date.slice(0, 10)}</TD><TD>{SURFACE_LABEL[m.surface]}</TD><TD>{m.winner === "a" ? match.playerA.name : match.playerB.name}</TD><TD className="num">{m.score}</TD></TR>
              ))}</tbody></Table>
            </>
          )}
        </Panel>
        <Panel title="Momentum" subtitle="point-by-point">
          {momentum ? <div className="p-2"><MomentumChart data={momentum} /></div> : <EmptyState icon="info" title="Point-by-point data not available for this match" />}
        </Panel>
      </div>

      <Panel title="Advanced analytics" subtitle="from completed-match history; favourite/underdog by ranking">
        {pa?.analytics || pb?.analytics ? <AdvancedTable a={pa?.analytics ?? null} b={pb?.analytics ?? null} nameA={match.playerA.name} nameB={match.playerB.name} /> : <EmptyState icon="info" title="No stored match history for these players yet" />}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-5">
        <Panel title="Markets" subtitle={`${markets.length} markets`} className="xl:col-span-3" actions={<Link className="text-[11px] text-accent" href={`/odds?match=${encodeURIComponent(id)}`}>Compare books →</Link>}>
          {markets.length === 0 ? <EmptyState title="No odds for this match">Connect an odds provider or wait for markets to open.</EmptyState> : (
            <Table>
              <THead><TR><TH>Market</TH><TH>Selection</TH><TH className="text-right">Best</TH><TH>Book</TH><TH className="text-right">Avg</TH><TH className="text-right">Open</TH><TH className="text-right">Move</TH><TH className="text-right">Implied</TH><TH className="text-right">No-vig</TH><TH>Updated</TH></TR></THead>
              <tbody>
                {markets.flatMap((mr) => mr.selections.map((s, i) => (
                  <TR key={mr.market + mr.line + s.selection}>
                    <TD className="text-muted">{i === 0 ? `${MARKET_LABEL[mr.market]}${mr.line != null ? ` ${mr.line}` : ""}` : ""}</TD>
                    <TD>{s.label}</TD>
                    <TD className="num text-right font-semibold">{fmtOdds(s.bestOdds)}</TD>
                    <TD className="text-muted">{s.bestBookmaker}</TD>
                    <TD className="num text-right text-muted">{fmtOdds(s.averageOdds)}</TD>
                    <TD className="num text-right text-muted">{fmtOdds(s.openingOdds)}</TD>
                    <TD className="text-right"><Delta value={s.movementPct} /></TD>
                    <TD className="num text-right">{fmtPct(s.impliedProbability)}</TD>
                    <TD className="num text-right text-accent">{fmtPct(s.consensusProbability)}</TD>
                    <TD><SourceTag provider={mr.providers[0] ?? ""} at={s.bestUpdatedAt} /></TD>
                  </TR>
                )))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Line history" subtitle={`${match.playerA.name} to win`} className="xl:col-span-2" actions={<Link className="text-[11px] text-accent" href={`/movement?match=${encodeURIComponent(id)}`}>Analyse →</Link>}>
          {series.length ? <div className="p-2"><OddsHistoryChart data={series} books={books} height={280} /></div> : <EmptyState title="No stored line history">{history.note}</EmptyState>}
        </Panel>
      </div>
    </>
  );
}

function age(birth: string | null) {
  if (!birth) return null;
  return Math.floor((Date.now() - Date.parse(birth)) / (365.25 * 86_400_000));
}

function PlayerHead({ p, winner, serving, right }: { p: Player; winner: boolean; serving: boolean; right?: boolean }) {
  const cells: [string, React.ReactNode][] = [
    [`${p.tour ? TOUR_LABEL[p.tour] : ""} rank`, p.rank ? `#${p.rank}` : <Missing />],
    ["Points", p.rankingPoints?.toLocaleString() ?? <Missing />],
    ["Age", age(p.birthDate) ?? <Missing />],
    ["Country", p.countryCode ?? <Missing />],
    ["Plays", p.handedness ?? <Missing />],
    ["Height", p.heightCm ? `${p.heightCm} cm` : <Missing />],
  ];
  return (
    <div className={right ? "md:text-right" : ""}>
      <Link href={`/players/${encodeURIComponent(p.id)}`} className={`inline-flex items-center gap-2 text-lg font-semibold hover:text-accent ${winner ? "text-up" : ""}`}>
        {serving && <span className="h-2 w-2 rounded-full bg-warn" title="Serving" />}{p.name}
      </Link>
      <div className={`mt-2 grid grid-cols-3 gap-x-4 gap-y-1 ${right ? "md:justify-items-end" : ""}`}>
        {cells.map(([k, v]) => <div key={k}><div className="label-xs">{k}</div><div className="num">{v}</div></div>)}
      </div>
    </div>
  );
}

function StatsTable({ a, b }: { a: PlayerMatchStats; b: PlayerMatchStats }) {
  const pct = (n: number | null, d: number | null) => (ratio(n, d) == null ? null : fmtPct(ratio(n, d), 0) + ` (${n}/${d})`);
  const rows: [string, string | number | null, string | number | null][] = [
    ["First serve %", pct(a.firstServeIn, a.firstServeAttempts), pct(b.firstServeIn, b.firstServeAttempts)],
    ["1st serve pts won", pct(a.firstServePointsWon, a.firstServePointsPlayed), pct(b.firstServePointsWon, b.firstServePointsPlayed)],
    ["2nd serve pts won", pct(a.secondServePointsWon, a.secondServePointsPlayed), pct(b.secondServePointsWon, b.secondServePointsPlayed)],
    ["Break pts saved", pct(a.breakPointsSaved, a.breakPointsFaced), pct(b.breakPointsSaved, b.breakPointsFaced)],
    ["Break pts converted", pct(a.breakPointsConverted, a.breakPointsOpportunities), pct(b.breakPointsConverted, b.breakPointsOpportunities)],
    ["Aces", a.aces, b.aces],
    ["Double faults", a.doubleFaults, b.doubleFaults],
    ["Service games won", pct(a.serviceGamesWon, a.serviceGamesPlayed), pct(b.serviceGamesWon, b.serviceGamesPlayed)],
    ["Return games won", pct(a.returnGamesWon, a.returnGamesPlayed), pct(b.returnGamesWon, b.returnGamesPlayed)],
    ["Total points won", a.totalPointsWon, b.totalPointsWon],
    ["Winners", a.winners, b.winners],
    ["Unforced errors", a.unforcedErrors, b.unforcedErrors],
  ];
  return (
    <Table>
      <tbody>
        {rows.map(([k, x, y]) => (
          <TR key={k}>
            <TD className="num w-1/3 text-right">{x ?? <Missing />}</TD>
            <TD className="label-xs text-center">{k}</TD>
            <TD className="num w-1/3">{y ?? <Missing />}</TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

function AdvancedTable({ a, b, nameA, nameB }: { a: PlayerAnalytics | null; b: PlayerAnalytics | null; nameA: string; nameB: string }) {
  const w = (x: WL | undefined) => (x && x.wins + x.losses ? `${x.wins}-${x.losses} (${fmtPct(x.pct, 0)})` : null);
  const rows: [string, (p: PlayerAnalytics) => React.ReactNode][] = [
    ["Overall", (p) => w(p.overall)],
    ["Hard", (p) => w(p.bySurface.hard)], ["Clay", (p) => w(p.bySurface.clay)], ["Grass", (p) => w(p.bySurface.grass)], ["Indoor", (p) => w(p.bySurface.indoor_hard)],
    ["Last 5", (p) => w(p.last5)], ["Last 10", (p) => w(p.last10)], ["Last 20", (p) => w(p.last20)],
    ["Form", (p) => <span className="tracking-widest">{p.form.map((f, i) => <span key={i} className={f === "W" ? "text-up" : "text-down"}>{f}</span>)}</span>],
    ["vs Top 10", (p) => w(p.byOpponentRank.top10)], ["vs 11–50", (p) => w(p.byOpponentRank["11-50"])], ["vs 51–100", (p) => w(p.byOpponentRank["51-100"])],
    ["As favourite", (p) => w(p.asFavourite)], ["As underdog", (p) => w(p.asUnderdog)],
    ["Hold %", (p) => fmtPct(p.holdPct)], ["Break %", (p) => fmtPct(p.breakPct)], ["Tiebreaks", (p) => w(p.tiebreaks)],
    ["Matches last 7 / 14d", (p) => `${p.workload.matchesLast7d} / ${p.workload.matchesLast14d}`],
    ["Minutes last 7d", (p) => p.workload.minutesLast7d], ["Sets last 7d", (p) => p.workload.setsLast7d], ["Days since last match", (p) => p.workload.daysSinceLastMatch],
  ];
  return (
    <div className="grid gap-x-6 md:grid-cols-2">
      {[rows.slice(0, 11), rows.slice(11)].map((chunk, ci) => (
        <Table key={ci}>
          <THead><TR><TH>Metric</TH><TH className="text-right">{nameA}</TH><TH className="text-right">{nameB}</TH></TR></THead>
          <tbody>
            {chunk.map(([k, f]) => (
              <TR key={k}>
                <TD className="text-muted">{k}</TD>
                <TD className="num text-right">{a ? f(a) ?? <Missing /> : <Missing />}</TD>
                <TD className="num text-right">{b ? f(b) ?? <Missing /> : <Missing />}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      ))}
    </div>
  );
}

