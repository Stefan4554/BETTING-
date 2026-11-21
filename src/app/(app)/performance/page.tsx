import { getContext, getResolvedRange } from "@/lib/server/context";
import { buildAnalytics, loadAnalyticsBase } from "@/lib/server/analytics";
import { PerformanceView } from "@/components/analytics/performance";

export const metadata = { title: "Performance Analytics" };

export default async function PerformancePage() {
  const ctx = await getContext();
  const { range, setting } = await getResolvedRange();
  const a = buildAnalytics(ctx, await loadAnalyticsBase(ctx), range);
  return <PerformanceView a={a} rangeLabel={setting.label} />;
}
