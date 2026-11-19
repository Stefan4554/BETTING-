import { notFound } from "next/navigation";
import { getModel, getPlayer, getPlayers } from "@/lib/data/service";
import { fmtPct, SURFACE_LABEL, TOUR_LABEL } from "@/lib/format";
import { EmptyState, Missing, PageHeader, Panel, StatTile } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { WL } from "@/lib/engine/player-analytics";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const [data, players, model] = await Promise.all([getPlayer(id), getPlayers(), getModel()]);
  if (!data) notFound();
  const { player: p, analytics: a, recent } = data;
  const name = (pid: string) => players.find((x) => x.id === pid)?.name ?? pid;
  const rating = model.model?.ratings.get(id);
  const w = (x: WL) => (x.wins + x.losses ? `${x.wins}-${x.losses} · ${fmtPct(x.pct, 0)}` : "—");
  return (
    <>
      <PageHeader title={p.name} description={[p.tour && TOUR_LABEL[p.tour], p.countryCode].filter(Boolean).join(" · ")} />
      <Panel bodyClassName="grid grid-cols-3 md:grid-cols-8">
        <StatTile label="Rank" value={p.rank ? `#${p.rank}` : <Missing />} />
        <StatTile label="Points" value={p.rankingPoints?.toLocaleString() ?? <Missing />} />
        <StatTile label="Born" value={p.birthDate ?? <Missing />} />
        <StatTile label="Plays" value={p.handedness ?? <Missing />} />
        <StatTile label="Height" value={p.heightCm ? `${p.heightCm} cm` : <Missing />} />
        <StatTile label="Elo" value={rating ? Math.round(rating.overall) : <Missing reason="Not enough history" />} />
        <StatTile label="Hold %" value={fmtPct(a?.holdPct)} />
        <StatTile label="Break %" value={fmtPct(a?.breakPct)} />
      </Panel>
      {!a ? <Panel><EmptyState icon="info" title="No stored match history for this player" /></Panel> : (
        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title="Splits">
            <Table><tbody>
              {([["Overall", a.overall], ["Last 5", a.last5], ["Last 10", a.last10], ["Last 20", a.last20], ["As favourite (rank)", a.asFavourite], ["As underdog (rank)", a.asUnderdog], ["Tiebreaks", a.tiebreaks]] as [string, WL][]).map(([k, x]) => <TR key={k}><TD className="text-muted">{k}</TD><TD className="num text-right">{w(x)}</TD></TR>)}
            </tbody></Table>
          </Panel>
          <Panel title="Surface & opponent level">
            <Table><tbody>
              {Object.entries(a.bySurface).map(([s, x]) => <TR key={s}><TD className="text-muted">{SURFACE_LABEL[s]}</TD><TD className="num text-right">{w(x)}</TD><TD className="num text-right text-accent">{rating?.surface[s as "hard"] ? Math.round(rating.surface[s as "hard"]!.rating) : "—"}</TD></TR>)}
              {Object.entries(a.byOpponentRank).map(([s, x]) => <TR key={s}><TD className="text-muted">vs {s}</TD><TD className="num text-right">{w(x)}</TD><TD /></TR>)}
            </tbody></Table>
          </Panel>
          <Panel title="Workload & fatigue">
            <Table><tbody>
              {[["Matches last 7 days", a.workload.matchesLast7d], ["Matches last 14 days", a.workload.matchesLast14d], ["Minutes on court, 7 days", a.workload.minutesLast7d], ["Sets, 7 days", a.workload.setsLast7d], ["Days since last match", a.workload.daysSinceLastMatch]].map(([k, v]) => <TR key={String(k)}><TD className="text-muted">{k}</TD><TD className="num text-right">{v ?? <Missing />}</TD></TR>)}
            </tbody></Table>
          </Panel>
        </div>
      )}
      <Panel title="Recent matches">
        {recent.length === 0 ? <EmptyState icon="info" title="None stored" /> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Opponent</TH><TH>Surface</TH><TH>Result</TH><TH>Score</TH><TH className="text-right">Minutes</TH></TR></THead>
            <tbody>{recent.map((m) => {
              const won = m.winnerId === id;
              return <TR key={m.id}><TD className="num text-muted">{m.date.slice(0, 10)}</TD><TD>{name(won ? m.loserId : m.winnerId)}</TD><TD className="text-muted">{SURFACE_LABEL[m.surface]}</TD><TD className={won ? "text-up" : "text-down"}>{won ? "W" : "L"}</TD><TD className="num">{m.sets.map((s) => (won ? `${s.w}-${s.l}` : `${s.l}-${s.w}`)).join(" ")}</TD><TD className="num text-right">{m.durationMin ?? <Missing />}</TD></TR>;
            })}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
