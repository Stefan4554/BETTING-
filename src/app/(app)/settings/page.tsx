import { getContext } from "@/lib/server/context";
import { SettingsView } from "@/components/settings/settings";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getContext();
  const [rates, providers, conns, logs, demo] = await Promise.all([
    ctx.sb.from("exchange_rates").select("*").order("as_of", { ascending: false }).limit(300),
    ctx.sb.from("odds_providers").select("*").order("name"),
    ctx.sb.from("api_connections").select("*").order("created_at"),
    ctx.sb.from("api_request_logs").select("*").order("at", { ascending: false }).limit(60),
    ctx.sb.from("bets").select("id", { count: "exact", head: true }).eq("is_demo", true),
  ]);
  const [outbox, events] = await Promise.all([
    ctx.sb.from("email_outbox").select("*").order("created_at", { ascending: false }).limit(50),
    ctx.sb.from("email_events").select("*").order("at", { ascending: false }).limit(200),
  ]);
  const e = env();
  return <SettingsView tab={(await searchParams).tab ?? "general"} settings={ctx.settings} profile={ctx.profile} email={ctx.user.email}
    rates={rates.data ?? []} providers={providers.data ?? []} connections={conns.data ?? []} logs={logs.data ?? []} demoBets={demo.count ?? 0} outbox={outbox.data ?? []} emailEvents={events.data ?? []}
    serverCaps={{ encryption: Boolean(e.API_KEY_ENCRYPTION_KEY), serviceRole: Boolean(e.SUPABASE_SERVICE_ROLE_KEY), email: Boolean(e.RESEND_API_KEY && e.ALERTS_FROM_EMAIL), emailWebhook: Boolean(e.RESEND_WEBHOOK_SECRET), platformOddsKey: Boolean(e.THE_ODDS_API_KEY) }} />;
}
