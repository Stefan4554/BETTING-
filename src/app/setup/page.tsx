import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Setup required" };

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="w-full max-w-xl rounded-[3px] border border-line bg-panel p-6 text-xs leading-5">
        <h1 className="mb-2 text-base font-semibold">Connect a database to start</h1>
        <p className="text-muted">Betting Edge Pro stores every bet, transaction and setting in Supabase (PostgreSQL with row-level security). Nothing is kept in the browser and no data is invented.</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Create a Supabase project (or run <code className="num">npx supabase start</code> locally).</li>
          <li>Apply the migrations in <code className="num">supabase/migrations</code> (<code className="num">npx supabase db push</code>).</li>
          <li>Set <code className="num">NEXT_PUBLIC_SUPABASE_URL</code>, <code className="num">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and the server-only <code className="num">SUPABASE_SERVICE_ROLE_KEY</code> and <code className="num">API_KEY_ENCRYPTION_KEY</code>.</li>
          <li>Restart the app, register, and use the <b>DEMO</b> switch to explore with simulated data.</li>
        </ol>
        <p className="mt-3 text-muted">See docs/SETUP.md for details.</p>
      </div>
    </div>
  );
}
