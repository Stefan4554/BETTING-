import Link from "next/link";
import { getMarketRows, getSnapshot } from "@/lib/data/service";
import { FINISHED_STATUSES } from "@/lib/domain";
import { fmtOdds, fmtPct, fmtTime, MARKET_LABEL } from "@/lib/format";
import { Delta, EmptyState, MatchLabel, Notices, PageHeader, Panel, SourceTag, StatusPill } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Betting lines board" };

export default async function LinesPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const { market = "match_winner" } = await searchParams;
  const snap = await getSnapshot();
  const open = snap.matches.filter((m) => !FINISHED_STATUSES.includes(m.status) && (snap.quotes[m.id] ?? []).length);
  const boards = await Promise.all(open.map(async (m) => ({ m, rows: await getMarketRows(m.id) })));
  const markets = [...new Set(boards.flatMap((b) => b.rows.map((r) => r.market)))];

  return (
    <>
      <PageHeader title="Betting lines board" description="Best price, average, opening vs current, implied and no-vig consensus probability per selection. All prices carry source and timestamp." />
      <Notices notices={snap.notices} />
      <div className="flex flex-wrap gap-1">
        {markets.map((mk) => (
          <Link key={mk} href={`/lines?market=${mk}`} className={`rounded-[3px] border px-2 py-1 text-xs ${mk === market ? "border-accent bg-accent-soft text-fg" : "border-line-strong text-muted hover:text-fg"}`}>
            {MARKET_LABEL[mk]}
          </Link>
        ))}
        <span className="ml-auto self-center text-[11px] text-dim">Markets depend on what the connected provider offers (The Odds API: match winner, game handicap, total games).</span>
      </div>
      <Panel title={MARKET_LABEL[market] ?? market} subtitle={`${boards.length} matches`}>
        {boards.length === 0 ? <EmptyState title="No open markets">Connect an odds provider to populate the board.</EmptyState> : (
          <Table>
            <THead>
              <TR>
                <TH>Start</TH><TH>Match</TH><TH>Status</TH><TH>Line</TH><TH>Selection</TH>
                <TH className="text-right">Best</TH><TH>Best book</TH><TH className="text-right">Avg</TH><TH className="text-right">Open</TH><TH className="text-right">Current</TH>
                <TH className="text-right">Move</TH><TH className="text-right">Implied</TH><TH className="text-right">Consensus</TH><TH className="text-right">Margin</TH><TH className="text-right">Books</TH><TH>Source</TH>
              </TR>
            </THead>
            <tbody>
              {boards.flatMap(({ m, rows }) =>
                rows.filter((r) => r.market === market).flatMap((r, ri) =>
                  r.selections.map((s, si) => (
                    <TR key={m.id + r.line + s.selection} className={si === 0 && ri === 0 ? "border-t border-line-strong" : ""}>
                      <TD className="num text-muted">{si === 0 && ri === 0 ? fmtTime(m.scheduledAt) : ""}</TD>
                      <TD className="max-w-56">{si === 0 && ri === 0 ? <MatchLabel m={m} /> : null}</TD>
                      <TD>{si === 0 && ri === 0 ? <StatusPill status={m.status} /> : null}</TD>
                      <TD className="num text-muted">{si === 0 ? r.line ?? "" : ""}</TD>
                      <TD className="max-w-48 truncate">{s.label}</TD>
                      <TD className="num text-right font-semibold text-fg">{fmtOdds(s.bestOdds)}</TD>
                      <TD className="text-muted">{s.bestBookmaker}</TD>
                      <TD className="num text-right text-muted">{fmtOdds(s.averageOdds)}</TD>
                      <TD className="num text-right text-muted">{fmtOdds(s.openingOdds)}</TD>
                      <TD className="num text-right">{fmtOdds(s.currentOdds)}</TD>
                      <TD className="text-right"><Delta value={s.movementPct} /></TD>
                      <TD className="num text-right">{fmtPct(s.impliedProbability)}</TD>
                      <TD className="num text-right text-accent">{fmtPct(s.consensusProbability)}</TD>
                      <TD className="num text-right text-muted">{si === 0 ? fmtPct(r.overround, 1) : ""}</TD>
                      <TD className="num text-right text-muted">{si === 0 ? r.booksQuoting : ""}</TD>
                      <TD>{si === 0 ? <SourceTag provider={r.providers[0] ?? ""} at={r.lastUpdate} /> : null}</TD>
                    </TR>
                  )),
                ),
              )}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
