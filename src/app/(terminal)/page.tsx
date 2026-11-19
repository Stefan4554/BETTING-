import Link from "next/link";
import { getSnapshot, getValueCandidates, getOddsHistory } from "@/lib/data/service";
import { buildMarketRows } from "@/lib/data/board";
import { getBetStorage } from "@/lib/data/bets";
import { summarize, betProfit } from "@/lib/engine/bets";
import { DEFAULT_VALUE_SETTINGS, passesThresholds } from "@/lib/engine/value";
import { LIVE_STATUSES, FINISHED_STATUSES } from "@/lib/domain";
import { fmtMoney, fmtOdds, fmtPct, fmtTime, SURFACE_LABEL } from "@/lib/format";
import { Delta, EmptyState, MatchLabel, Missing, Notices, Panel, ScoreLine, SourceTag, StatTile, StatusPill } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BankrollChart } from "@/components/charts/charts";
import { bankrollCurve } from "@/lib/engine/bets";
import { detectSteamMoves } from "@/lib/engine/movement";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const snap = await getSnapshot();
  const [value, betsInfo] = await Promise.all([getValueCandidates(), getBetStorage()]);
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = snap.matches.filter((m) => m.scheduledAt.slice(0, 10) === todayKey);
  const live = snap.matches.filter((m) => LIVE_STATUSES.includes(m.status));
  const upcoming = snap.matches.filter((m) => m.status === "scheduled").slice(0, 10);
  const results = snap.matches.filter((m) => FINISHED_STATUSES.includes(m.status)).slice(-8).reverse();

  const rows = await Promise.all(
    snap.matches
      .filter((m) => (snap.quotes[m.id] ?? []).length)
      .map(async (m) => {
        const h = await getOddsHistory(m.id);
        const mr = buildMarketRows(m.id, snap.quotes[m.id]!, h.points);
        const steam = detectSteamMoves(h.points.filter((p) => p.market === "match_winner" && p.selection === "a").map((p) => ({ bookmaker: p.bookmaker, odds: p.odds, at: p.capturedAt })));
        return { m, mw: mr.find((r) => r.market === "match_winner"), steam: steam.length };
      }),
  );
  const movers = rows
    .flatMap((r) => (r.mw?.selections ?? []).map((s) => ({ m: r.m, s, steam: r.steam })))
    .filter((x) => x.s.movementPct != null)
    .sort((a, b) => Math.abs(b.s.movementPct!) - Math.abs(a.s.movementPct!));
  const avgMove = movers.length ? movers.reduce((a, x) => a + Math.abs(x.s.movementPct!), 0) / movers.length : null;
  const shortening = movers.filter((x) => x.s.movementPct! < -0.01).length;
  const drifting = movers.filter((x) => x.s.movementPct! > 0.01).length;
  const avgOverround = rows.filter((r) => r.mw?.overround != null).reduce((a, r, _i, arr) => a + r.mw!.overround! / arr.length, 0);
  const steamCount = rows.reduce((a, r) => a + r.steam, 0);

  const passing = value.filter((v) => passesThresholds(v));
  const bets = betsInfo.bets;
  const todayBets = bets.filter((b) => b.placedAt.slice(0, 10) === todayKey);
  const settledToday = bets.filter((b) => (b.settledAt ?? "").slice(0, 10) === todayKey);
  const summary = summarize(bets, 1000);
  const curve = bankrollCurve(bets, 1000);

  return (
    <>
      <Notices notices={snap.notices} />
      <Panel bodyClassName="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9">
        <StatTile label="Matches today" value={today.length} sub={`${snap.matches.length} in feed`} />
        <StatTile label="Live" value={live.length} tone={live.length ? "up" : undefined} />
        <StatTile label="Avg odds move" value={fmtPct(avgMove, 2)} sub="match winner, best price" />
        <StatTile label="Value opps" value={passing.length} sub={`EV ≥ ${fmtPct(DEFAULT_VALUE_SETTINGS.minEdge, 0)}`} />
        <StatTile label="Volume today" value={bets.length ? fmtMoney(todayBets.reduce((a, b) => a + b.stake, 0)) : <Missing reason="No tracked bets" />} sub={`${todayBets.length} bets`} />
        <StatTile
          label="P/L today"
          value={bets.length ? fmtMoney(settledToday.reduce((a, b) => a + (betProfit(b) ?? 0), 0)) : <Missing reason="No tracked bets" />}
          tone={settledToday.reduce((a, b) => a + (betProfit(b) ?? 0), 0) >= 0 ? "up" : "down"}
        />
        <StatTile label="ROI / yield" value={bets.length ? fmtPct(summary.yield, 1, true) : <Missing />} tone={summary.yield >= 0 ? "up" : "down"} sub="on settled stakes" />
        <StatTile label="Win rate" value={bets.length ? fmtPct(summary.winRate) : <Missing />} sub={`${summary.settled} settled`} />
        <StatTile label="Avg CLV" value={summary.averageClv != null ? fmtPct(summary.averageClv, 2, true) : <Missing reason="No closing odds recorded" />} tone={(summary.averageClv ?? 0) >= 0 ? "up" : "down"} sub={`${summary.clvSample} bets w/ close`} />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Live / in progress" subtitle={`${live.length} matches`} actions={<Link href="/live" className="text-[11px] text-accent">Live centre →</Link>} className="xl:col-span-2">
          {live.length === 0 ? (
            <EmptyState icon="info" title="No matches in progress" />
          ) : (
            <Table>
              <THead><TR><TH>Match</TH><TH>Tournament</TH><TH>Status</TH><TH>Score</TH><TH className="text-right">Best A</TH><TH className="text-right">Best B</TH><TH>Source</TH></TR></THead>
              <tbody>
                {live.map((m) => {
                  const mw = rows.find((r) => r.m.id === m.id)?.mw;
                  return (
                    <TR key={m.id}>
                      <TD className="max-w-56"><MatchLabel m={m} /></TD>
                      <TD className="text-muted">{m.tournament.name}</TD>
                      <TD><StatusPill status={m.status} /></TD>
                      <TD><ScoreLine score={m.score} /></TD>
                      <TD className="num text-right">{fmtOdds(mw?.selections.find((s) => s.selection === "a")?.bestOdds)}</TD>
                      <TD className="num text-right">{fmtOdds(mw?.selections.find((s) => s.selection === "b")?.bestOdds)}</TD>
                      <TD><SourceTag provider={m.source.provider} at={m.source.updatedAt ?? m.source.fetchedAt} /></TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Notifications & alerts" actions={<Link href="/alerts" className="text-[11px] text-accent">Manage →</Link>}>
          <ul className="divide-y divide-line/70 text-xs">
            {movers.slice(0, 3).map((x) => (
              <li key={x.m.id + x.s.selection} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="truncate">Odds move · {x.s.label}</span>
                <Delta value={x.s.movementPct} />
              </li>
            ))}
            {passing.slice(0, 3).map((v) => (
              <li key={v.matchId + v.selection} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="truncate">Value · {v.selectionLabel} @ {fmtOdds(v.bestOdds)}</span>
                <Badge tone="up">EV {fmtPct(v.expectedValue, 1, true)}</Badge>
              </li>
            ))}
            {steamCount > 0 && <li className="px-3 py-1.5 text-warn">{steamCount} steam move(s) detected in the last 24h</li>}
            {movers.length === 0 && passing.length === 0 && <li className="px-3 py-3 text-muted">No signals. Alerts fire from rules you configure.</li>}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Upcoming" subtitle="best match-winner prices" actions={<Link href="/upcoming" className="text-[11px] text-accent">All →</Link>}>
          {upcoming.length === 0 ? <EmptyState title="No scheduled matches in feed" /> : (
            <Table>
              <THead><TR><TH>Time</TH><TH>Match</TH><TH className="text-right">A</TH><TH className="text-right">B</TH></TR></THead>
              <tbody>
                {upcoming.map((m) => {
                  const mw = rows.find((r) => r.m.id === m.id)?.mw;
                  return (
                    <TR key={m.id}>
                      <TD className="num text-muted">{fmtTime(m.scheduledAt)}</TD>
                      <TD className="max-w-52"><MatchLabel m={m} /></TD>
                      <TD className="num text-right">{fmtOdds(mw?.selections.find((s) => s.selection === "a")?.bestOdds)}</TD>
                      <TD className="num text-right">{fmtOdds(mw?.selections.find((s) => s.selection === "b")?.bestOdds)}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Biggest odds movements" subtitle="opening → current best" actions={<Link href="/movement" className="text-[11px] text-accent">Analyse →</Link>}>
          {movers.length === 0 ? <EmptyState title="No line history yet" /> : (
            <Table>
              <THead><TR><TH>Selection</TH><TH className="text-right">Open</TH><TH className="text-right">Now</TH><TH className="text-right">Move</TH></TR></THead>
              <tbody>
                {movers.slice(0, 10).map((x) => (
                  <TR key={x.m.id + x.s.selection}>
                    <TD className="max-w-52 truncate"><Link href={`/movement?match=${encodeURIComponent(x.m.id)}`} className="hover:text-accent">{x.s.label}</Link>{x.steam > 0 && <Badge tone="warn" className="ml-1">steam</Badge>}</TD>
                    <TD className="num text-right text-muted">{fmtOdds(x.s.openingOdds)}</TD>
                    <TD className="num text-right">{fmtOdds(x.s.currentOdds)}</TD>
                    <TD className="text-right"><Delta value={x.s.movementPct} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Value opportunities" subtitle="model vs best price" actions={<Link href="/value" className="text-[11px] text-accent">Engine →</Link>}>
          {passing.length === 0 ? (
            <EmptyState title="No selections pass the current thresholds">Value requires both a model probability and live prices. Missing inputs are never filled with guesses.</EmptyState>
          ) : (
            <Table>
              <THead><TR><TH>Selection</TH><TH className="text-right">Odds</TH><TH className="text-right">Fair</TH><TH className="text-right">EV</TH><TH>Conf.</TH></TR></THead>
              <tbody>
                {passing.slice(0, 10).map((v) => (
                  <TR key={v.matchId + v.selection}>
                    <TD className="max-w-48 truncate">{v.selectionLabel}</TD>
                    <TD className="num text-right">{fmtOdds(v.bestOdds)}</TD>
                    <TD className="num text-right text-muted">{fmtOdds(v.fairOdds)}</TD>
                    <TD className="num text-right text-up">{fmtPct(v.expectedValue, 1, true)}</TD>
                    <TD><Badge tone={v.confidence === "high" ? "up" : v.confidence === "medium" ? "accent" : "warn"}>{v.confidence}</Badge></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Market trends">
          <div className="grid grid-cols-2 gap-px bg-line">
            {[
              ["Shortening selections", shortening, "text-up"],
              ["Drifting selections", drifting, "text-down"],
              ["Avg best-price overround", fmtPct(avgOverround || null, 2), ""],
              ["Steam moves (24h)", steamCount, "text-warn"],
              ["Matches with markets", rows.length, ""],
              ["Books quoting (avg)", rows.length ? (rows.reduce((a, r) => a + (r.mw?.booksQuoting ?? 0), 0) / rows.length).toFixed(1) : "—", ""],
            ].map(([l, v, c]) => (
              <div key={String(l)} className="bg-panel px-3 py-2">
                <div className="label-xs">{l}</div>
                <div className={`num text-base ${c}`}>{v}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Recent results">
          {results.length === 0 ? <EmptyState icon="info" title="No completed matches in feed" /> : (
            <Table>
              <tbody>
                {results.map((m) => (
                  <TR key={m.id}>
                    <TD className="max-w-52"><MatchLabel m={m} /></TD>
                    <TD><ScoreLine score={m.score} /></TD>
                    <TD className="text-muted">{SURFACE_LABEL[m.surface]}</TD>
                    <TD><StatusPill status={m.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Betting performance" subtitle={betsInfo.storage === "demo" ? "demo history" : undefined} actions={<Link href="/performance" className="text-[11px] text-accent">Report →</Link>}>
          {curve.length === 0 ? <EmptyState icon="info" title="No settled bets yet"><Link className="text-accent" href="/tracker">Add a bet</Link> to start tracking ROI and CLV.</EmptyState> : <div className="p-2"><BankrollChart data={curve} height={190} /></div>}
        </Panel>
      </div>
    </>
  );
}
