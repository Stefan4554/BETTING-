import { getContext } from "@/lib/server/context";
import { AlertsView } from "@/components/tools/alerts";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const ctx = await getContext();
  const { data } = await ctx.sb.from("alerts").select("*").eq("is_demo", ctx.isDemo).eq("in_app", true).order("created_at", { ascending: false }).limit(500);
  return <AlertsView alerts={data ?? []} />;
}
