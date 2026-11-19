import { providerInfos } from "@/lib/providers/registry";
import { isDemoMode, isSupabaseConfigured, env } from "@/lib/env";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { usageStats } from "@/lib/providers/http";
import { EmptyState, PageHeader, Panel } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { TestButton } from "./test-button";

export const metadata = { title: "API management" };

export default async function ApiManagementPage() {
  if (isSupabaseConfigured()) {
    const u = await currentUser();
    if (u?.role !== "admin") return <Panel><EmptyState title="Administrators only">Ask an admin to set <code>users.role = &apos;admin&apos;</code> for your account.</EmptyState></Panel>;
  }
  const providers = providerInfos();
  const sb = supabaseAdmin();
  const logs = sb ? (await sb.from("api_logs").select("*").order("requested_at", { ascending: false }).limit(50)).data ?? [] : [];
  const e = env();
  const infra: [string, boolean, string][] = [
    ["Data mode", true, isDemoMode() ? "DEMO (synthetic data)" : "LIVE"],
    ["Supabase (auth, storage, realtime)", isSupabaseConfigured(), "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["Supabase service role (workers)", Boolean(e.SUPABASE_SERVICE_ROLE_KEY), "SUPABASE_SERVICE_ROLE_KEY"],
    ["Cron authentication", Boolean(e.CRON_SECRET), "CRON_SECRET"],
    ["Email alerts (Resend)", Boolean(e.RESEND_API_KEY && e.ALERTS_FROM_EMAIL), "RESEND_API_KEY + ALERTS_FROM_EMAIL"],
  ];
  const tone = { connected: "up", not_connected: "down", error: "down", not_implemented: "warn" } as const;
  return (
    <>
      <PageHeader title="API management" description="Provider status, credentials, usage and freshness. Keys are read from server-side environment variables only and are never sent to the browser." />
      <div className="grid gap-3 lg:grid-cols-2">
        {providers.map((p) => {
          const u = usageStats.get(p.id);
          return (
            <Panel key={p.id} title={p.name} subtitle={p.kind === "odds" ? "odds" : "sports data"} actions={<Badge tone={tone[p.status]}>{p.status === "not_connected" ? "NOT CONNECTED" : p.status.replace("_", " ")}</Badge>}>
              <div className="flex flex-col gap-2 p-3 text-xs">
                <p className={p.status === "connected" ? "text-muted" : "text-warn"}>{p.statusDetail}</p>
                <div className="grid grid-cols-[120px_1fr] gap-y-1">
                  <span className="label-xs">Credential</span><code className="num text-fg">{p.envVar}</code>
                  <span className="label-xs">Subscription</span><span>{p.subscription}</span>
                  <span className="label-xs">Provides</span><span className="text-muted">{p.capabilities.join(" · ")}</span>
                  <span className="label-xs">Requests</span><span className="num">{u ? `${u.requests} (${u.cacheHits} cached, ${u.errors} errors) this instance` : "none yet"}</span>
                  <span className="label-xs">Quota</span><span className="num">{u?.quotaRemaining != null ? `${u.quotaUsed} used · ${u.quotaRemaining} remaining` : "—"}</span>
                  <span className="label-xs">Last request</span><span className="num">{u?.lastRequestAt ? fmtAgo(u.lastRequestAt) : "—"}</span>
                  {u?.lastError && <><span className="label-xs">Last error</span><span className="text-down">{u.lastError}</span></>}
                  <span className="label-xs">Docs</span><a href={p.docsUrl} target="_blank" rel="noreferrer" className="truncate text-accent">{p.docsUrl}</a>
                </div>
                {p.status !== "not_implemented" && <TestButton id={p.id} disabled={p.status === "not_connected"} />}
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel title="Infrastructure">
        <Table><tbody>{infra.map(([k, ok, v]) => <TR key={k}><TD>{k}</TD><TD><Badge tone={ok ? "up" : "down"}>{ok ? "configured" : "missing"}</Badge></TD><TD className="num text-muted">{v}</TD></TR>)}</tbody></Table>
      </Panel>
      <Panel title="How to configure keys">
        <ol className="list-decimal space-y-1 py-3 pl-8 pr-3 text-xs text-muted">
          <li>Buy the subscription for the provider (see above) and copy the API key.</li>
          <li>Local: add it to <code>.env.local</code>. Production: Vercel → Project → Settings → Environment Variables (encrypted at rest).</li>
          <li>Redeploy (or restart <code>npm run dev</code>). The status above turns to <b>connected</b>; use <b>Test connection</b> to make one real request.</li>
          <li>Keys are never stored in the database in plain text and never reach client code. Do not paste keys into the browser.</li>
        </ol>
      </Panel>
      <Panel title="API log" subtitle={sb ? "last 50 provider requests (api_logs)" : "requires Supabase service role"}>
        {logs.length === 0 ? <EmptyState icon="info" title="No logged requests" /> : (
          <Table>
            <THead><TR><TH>Time</TH><TH>Provider</TH><TH>Endpoint</TH><TH className="text-right">Status</TH><TH className="text-right">ms</TH><TH className="text-right">Cost</TH><TH>Error</TH></TR></THead>
            <tbody>{logs.map((l) => <TR key={l.id}><TD className="num text-muted">{fmtDateTime(l.requested_at)}</TD><TD>{l.provider_id}</TD><TD className="num max-w-72 truncate">{l.endpoint}</TD><TD className={`num text-right ${l.status_code >= 400 ? "text-down" : ""}`}>{l.status_code ?? "—"}</TD><TD className="num text-right">{l.duration_ms}</TD><TD className="num text-right">{l.cost_units ?? "—"}</TD><TD className="max-w-72 truncate text-down">{l.error}</TD></TR>)}</tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
