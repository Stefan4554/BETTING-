import { getSnapshot } from "@/lib/data/service";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/terminal/primitives";
import { AlertsView } from "./view";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const snap = await getSnapshot();
  const user = await currentUser().catch(() => null);
  const mode = !isDemoMode() && isSupabaseConfigured() && user ? "server" : "browser";
  return (
    <>
      <PageHeader title="Alerts" description="Configurable rules on odds moves, target prices, value edges, consensus shifts, match start/status and model changes. In-app notifications, plus optional email (Resend) for server-evaluated rules." />
      <AlertsView mode={mode} userId={user?.id ?? null} matches={snap.matches.map((m) => ({ id: m.id, label: `${m.playerA.name} v ${m.playerB.name}` }))} />
    </>
  );
}
