import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Secrets are read only here and never reach client components.
 * Anything prefixed NEXT_PUBLIC_ is public by definition.
 */
const optional = z.string().optional().transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  /** 32-byte key (base64 or hex) used to encrypt user API keys at rest (AES-256-GCM). */
  API_KEY_ENCRYPTION_KEY: optional,
  /** Optional platform-wide provider keys (used by the ingestion cron for shared market data). */
  THE_ODDS_API_KEY: optional,
  API_FOOTBALL_KEY: optional,
  CRON_SECRET: optional,
  RESEND_API_KEY: optional,
  ALERTS_FROM_EMAIL: optional,
  /** Resend webhook signing secret (whsec_…) for delivery / bounce confirmations. */
  RESEND_WEBHOOK_SECRET: optional,
  APP_URL: optional,
});

export type ServerEnv = z.infer<typeof schema>;
let cached: ServerEnv | null = null;
export function env(): ServerEnv {
  cached ??= schema.parse(process.env);
  return cached;
}
export function isSupabaseConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
export function resetEnvCache() { cached = null; }
