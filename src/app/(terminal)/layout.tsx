import { Sidebar } from "@/components/terminal/sidebar";
import { Topbar } from "@/components/terminal/topbar";
import { isDemoMode, isSupabaseConfigured } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemoMode();
  const user = await currentUser().catch(() => null);
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar mode={demo ? "demo" : "live"} user={user?.email ?? null} authEnabled={isSupabaseConfigured()} />
        {demo && (
          <div className="shrink-0 border-b border-demo/40 bg-demo/10 px-3 py-1 text-center text-[11px] font-medium text-demo">
            DEMO MODE · All players, bookmakers, odds and statistics shown are synthetic and fictional. This is not live data.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto flex max-w-[1800px] flex-col gap-3">{children}</div>
        </main>
      </div>
    </div>
  );
}
