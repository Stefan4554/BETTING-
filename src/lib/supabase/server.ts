import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "../env";

/** Per-request client bound to the signed-in user's session (RLS applies). */
export async function supabaseServer(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes them.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
/**
 * Service-role client for ingestion workers ONLY. Bypasses RLS — never use it to
 * serve user-owned data and never import it into client components.
 */
export function supabaseAdmin(): SupabaseClient | null {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return null;
  admin ??= createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return admin;
}

export async function currentUser() {
  const sb = await supabaseServer();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await sb.from("users").select("id,email,role,kelly_fraction,max_stake_pct,min_edge_pct,model_confidence").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email ?? null, role: (profile?.role as "user" | "analyst" | "admin" | undefined) ?? "user", profile };
}
