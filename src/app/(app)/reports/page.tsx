import { getContext, getResolvedRange } from "@/lib/server/context";
import { REPORT_TYPES } from "@/lib/server/reports";
import { ReportsView } from "@/components/reports/reports";
import { localDateKey } from "@/lib/finance/dates";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await getContext();
  const { range } = await getResolvedRange();
  const day = (d: Date | null, minus = 0) => (d ? localDateKey(new Date(d.getTime() - minus), range.timeZone) : null);
  return <ReportsView types={REPORT_TYPES} defaultFrom={day(range.from)} defaultTo={day(range.to, 1)} defaultBasis={range.basis}
    sports={ctx.sports.map((s) => s.name)} bookmakers={ctx.bookmakers.map((b) => b.name)} strategies={[...ctx.strategies.map((s) => s.name), "No strategy"]} />;
}
