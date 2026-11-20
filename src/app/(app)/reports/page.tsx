import { getContext, getResolvedRange } from "@/lib/server/context";
import { REPORT_TYPES } from "@/lib/server/reports";
import { ReportsView } from "@/components/reports/reports";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await getContext();
  const { range } = await getResolvedRange();
  const day = (d: Date | null, minus = 0) => (d ? new Date(d.getTime() - minus).toISOString().slice(0, 10) : null);
  return <ReportsView types={REPORT_TYPES} defaultFrom={day(range.from)} defaultTo={day(range.to, 86_400_000)}
    sports={ctx.sports.map((s) => s.name)} bookmakers={ctx.bookmakers.map((b) => b.name)} strategies={[...ctx.strategies.map((s) => s.name), "No strategy"]} />;
}
