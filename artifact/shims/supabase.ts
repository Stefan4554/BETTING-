/** Supabase is never configured in the browser-only demo build. */
export function createClient(): never {
  throw new Error("Supabase is not available in the demo build");
}
export const createServerClient = createClient;
export const createBrowserClient = createClient;
export type SupabaseClient = never;
