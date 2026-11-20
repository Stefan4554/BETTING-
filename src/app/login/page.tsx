import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-[3px] border border-line bg-panel p-6">
        <div className="mb-5 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-[3px] bg-accent text-xs font-black text-white">BE</div>
          <div className="leading-3"><div className="text-sm font-bold tracking-[0.18em]">BETTING EDGE</div><div className="text-[9px] tracking-[0.28em] text-muted">PRO</div></div>
        </div>
        {isSupabaseConfigured() ? <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} /> : (
          <p className="text-xs text-warn">Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP.md).</p>
        )}
      </div>
    </div>
  );
}
