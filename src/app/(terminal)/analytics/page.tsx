import { matchRows } from "@/lib/data/views";
import { getModel, getPlayers, getSnapshot } from "@/lib/data/service";
import { playerAnalytics } from "@/lib/engine/player-analytics";
import { MatchTable } from "@/components/terminal/match-table";
import { Notices, PageHeader, Panel, EmptyState } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtPct, SURFACE_LABEL } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Tennis analytics" };

export default async function AnalyticsPage() {
  const [snap, rows, model, players] = await Promise.all([getSnapshot(), matchRows(() => true), getModel(), getPlayers()]);
  const stats = model.history.length ? players.map((p) => ({ p, a: playerAnalytics(p.id, model.history) })).filter((x) => x.a.matches >= 10) : [];
  const top = (f: (x: (typeof stats)[number]) => number | null, n = 8) => [...stats].filter((x) => f(x) != null).sort((x, y) => f(y)! - f(x)!).slice(0, n);
  const surfaceTotals = ["hard", "clay", "grass", "indoor_hard"].map((s) => {
    const ms = model.history.filter((h) => h.surface === s);
    const tb = ms.reduce((a, m) => a + m.sets.filter((x) => x.tb).length, 0);
    const sets = ms.reduce((a, m) => a + m.sets.length, 0);
    const svc = ms.filter((m) => m.svc);
    const held = svc.reduce((a, m) => a + m.svc!.w.held + m.svc!.l.held, 0);
    const played = svc.reduce((a, m) => a + m.svc!.w.played + m.svc!.l.played, 0);
    return { s, n: ms.length, tbRate: sets ? tb / sets : null, hold: played ? held / played : null };
  });
  const board = (title: string, f: (x: (typeof stats)[number]) => number | null) => (
    <Panel title={title}>
      {stats.length === 0 ? <EmptyState icon="info" title="Needs stored history" /> : (
        <Table><tbody>{top(f).map((x, i) => <TR key={x.p.id}><TD className="num w-6 text-dim">{i + 1}</TD><TD><Link href={`/players/${encodeURIComponent(x.p.id)}`} className="hover:text-accent">{x.p.name}</Link></TD><TD className="num text-right">{fmtPct(f(x), 1)}</TD></TR>)}</tbody></Table>
      )}
    </Panel>
  );
  return (
    <>
      <PageHeader title="Tennis analytics" description="Filter by tournament, level, surface, ranking, country, status and format. Leaderboards use players with ≥10 stored matches." />
      <Notices notices={snap.notices} />
      <Panel title="All matches" subtitle={`${rows.length}`}><MatchTable rows={rows} /></Panel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {board("Hold % leaders", (x) => x.a.holdPct)}
        {board("Break % leaders", (x) => x.a.breakPct)}
        {board("Last-10 win %", (x) => x.a.last10.pct)}
        {board("Tiebreak win %", (x) => (x.a.tiebreaks.wins + x.a.tiebreaks.losses >= 5 ? x.a.tiebreaks.pct : null))}
      </div>
      <Panel title="Surface profile" subtitle="stored history">
        <Table>
          <THead><TR><TH>Surface</TH><TH className="text-right">Matches</TH><TH className="text-right">Hold %</TH><TH className="text-right">Sets to tiebreak</TH></TR></THead>
          <tbody>{surfaceTotals.map((r) => <TR key={r.s}><TD>{SURFACE_LABEL[r.s]}</TD><TD className="num text-right">{r.n}</TD><TD className="num text-right">{fmtPct(r.hold)}</TD><TD className="num text-right">{fmtPct(r.tbRate)}</TD></TR>)}</tbody>
        </Table>
      </Panel>
    </>
  );
}
