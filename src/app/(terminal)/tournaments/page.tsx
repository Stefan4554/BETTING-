import { getSnapshot, getTournaments } from "@/lib/data/service";
import { SURFACE_LABEL, TOUR_LABEL } from "@/lib/format";
import { EmptyState, Missing, Notices, PageHeader, Panel } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { LIVE_STATUSES } from "@/lib/domain";

export const metadata = { title: "Tournament database" };

export default async function TournamentsPage() {
  const [snap, ts] = await Promise.all([getSnapshot(), getTournaments()]);
  return (
    <>
      <PageHeader title="Tournament database" description="Tournaments in the current feed with level, surface and format. Unknown surface means the provider did not report it." />
      <Notices notices={snap.notices} />
      <Panel title="Tournaments" subtitle={`${ts.length}`}>
        {ts.length === 0 ? <EmptyState title="No tournaments in feed" /> : (
          <Table>
            <THead><TR><TH>Tournament</TH><TH>Tour</TH><TH>Level</TH><TH>Surface</TH><TH>Format</TH><TH>Country</TH><TH className="text-right">Matches today</TH><TH className="text-right">Live</TH></TR></THead>
            <tbody>{ts.map((t) => {
              const ms = snap.matches.filter((m) => m.tournament.id === t.id);
              return (
                <TR key={t.id}>
                  <TD>{t.name}</TD><TD>{TOUR_LABEL[t.tour]}</TD><TD className="text-muted">{t.level ?? <Missing />}</TD>
                  <TD>{t.surface === "unknown" ? <Missing reason="Surface not reported by provider" /> : SURFACE_LABEL[t.surface]}</TD>
                  <TD className="num">{t.bestOf ? `Best of ${t.bestOf}` : <Missing />}</TD><TD>{t.countryCode ?? <Missing />}</TD>
                  <TD className="num text-right">{ms.length}</TD><TD className="num text-right text-up">{ms.filter((m) => LIVE_STATUSES.includes(m.status)).length}</TD>
                </TR>
              );
            })}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
