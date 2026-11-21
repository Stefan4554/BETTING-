import { getContext, getResolvedRange } from "@/lib/server/context";
import { buildAnalytics, loadAnalyticsBase } from "@/lib/server/analytics";
import { DashboardView } from "@/components/dashboard/dashboard";
import { goalProgress } from "@/lib/server/goals";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const base = await loadAnalyticsBase(ctx);
  const a = buildAnalytics(ctx, base, range);
  const widgets = Array.isArray(ctx.settings.dashboard_widgets) ? (ctx.settings.dashboard_widgets as string[]) : [];
  const goals = await goalProgress(ctx, base.conv.records, base.totals.equity);
  return <DashboardView a={a} widgets={widgets} rangeLabel={setting.label} hasPrevious={a.previous != null} goals={goals} />;
}
