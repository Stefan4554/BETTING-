import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Provider keys are only ever read here and are never
 * passed to client components. Anything prefixed NEXT_PUBLIC_ is safe to expose.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  THE_ODDS_API_KEY: optional,
  THE_ODDS_API_REGIONS: z.string().default("eu,uk"),
  THE_ODDS_API_MARKETS: z.string().default("h2h,spreads,totals"),

  SPORTRADAR_TENNIS_API_KEY: optional,
  SPORTRADAR_TENNIS_ACCESS_LEVEL: z.enum(["trial", "production"]).default("trial"),
  SPORTRADAR_ODDS_API_KEY: optional,

  API_TENNIS_KEY: optional,

  RESEND_API_KEY: optional,
  ALERTS_FROM_EMAIL: optional,

  CRON_SECRET: optional,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;
export function env(): ServerEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function isDemoMode(): boolean {
  return env().NEXT_PUBLIC_DEMO_MODE === "true";
}

export function isSupabaseConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Test hook. */
export function resetEnvCache() {
  cached = null;
}
