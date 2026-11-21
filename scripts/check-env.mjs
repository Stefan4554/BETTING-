#!/usr/bin/env node
// Validates production environment variables without printing their values.
//   node scripts/check-env.mjs            (reads process.env, e.g. after `vercel env pull .env.production.local`)
const req = {
  NEXT_PUBLIC_SUPABASE_URL: (v) => /^https:\/\/.+\.supabase\.co\/?$/.test(v) || /^https?:\/\//.test(v) || "must be the project URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: (v) => v.length > 30 || "looks too short",
  SUPABASE_SERVICE_ROLE_KEY: (v) => v.length > 30 || "looks too short",
  API_KEY_ENCRYPTION_KEY: (v) => /^[0-9a-f]{64}$/i.test(v) || Buffer.from(v, "base64").length === 32 || "must be 32 bytes (64 hex chars)",
  CRON_SECRET: (v) => v.length >= 16 || "use at least 16 random characters",
};
const opt = {
  RESEND_API_KEY: (v) => v.startsWith("re_") || "Resend keys start with re_",
  ALERTS_FROM_EMAIL: (v) => /@/.test(v) || "e.g. Betting Edge <alerts@yourdomain.com>",
  RESEND_WEBHOOK_SECRET: (v) => v.startsWith("whsec_") || "Svix secrets start with whsec_",
  APP_URL: (v) => /^https:\/\//.test(v) || "public https URL of the deployment",
};
let bad = 0;
for (const [k, check] of Object.entries(req)) {
  const v = process.env[k];
  const r = v ? check(v) : "missing";
  if (r !== true) { bad++; console.log(`✗ ${k}: ${r}`); } else console.log(`✓ ${k}`);
}
for (const [k, check] of Object.entries(opt)) {
  const v = process.env[k];
  if (!v) { console.log(`· ${k}: not set (optional)`); continue; }
  const r = check(v); console.log(r === true ? `✓ ${k}` : `✗ ${k}: ${r}`); if (r !== true) bad++;
}
if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) { bad++; console.log("✗ NEVER expose the service role key with a NEXT_PUBLIC_ prefix"); }
process.exit(bad ? 1 : 0);
