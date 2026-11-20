import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "../env";
import type { Database } from "./database.types";

export type DB = SupabaseClient<Database>;

/** Per-request client bound to the signed-in user's session — RLS applies to every query. */
export async function supabaseServer(): Promise<DB | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  const e = env();
  return createServerClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Component: read-only cookies; middleware refreshes the session */ }
      },
    },
  });
}

let admin: DB | null = null;
/**
 * Service-role client. Bypasses RLS: use ONLY for ingestion workers, encrypted secret
 * access and request logging — never to serve user-owned data to a request.
 */
export function supabaseAdmin(): DB | null {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return null;
  admin ??= createClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return admin;
}
