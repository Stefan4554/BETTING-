import "server-only";
import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Map database exceptions (CODE: message) and validation errors to user-facing messages. */
export function fail(e: unknown): ActionResult<never> {
  if (e && typeof e === "object" && "issues" in e) {
    const z = e as ZodError;
    const fieldErrors: Record<string, string> = {};
    for (const i of z.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: z.issues[0]?.message ?? "Invalid input", fieldErrors };
  }
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  const clean = msg.replace(/^(AUTH_REQUIRED|NOT_FOUND|VALIDATION|ALREADY_SETTLED|SETTLED_LOCKED|INSUFFICIENT_FUNDS|RISK_LIMIT|FX_MISSING|DUPLICATE|ARCHIVED|LEDGER_IMMUTABLE):\s*/, (_m, code: string) =>
    code === "RISK_LIMIT" ? "Risk limit: " : code === "INSUFFICIENT_FUNDS" ? "Insufficient funds: " : code === "FX_MISSING" ? "Missing exchange rate: " : "");
  return { ok: false, error: clean };
}

export async function run<T>(fn: () => Promise<T>, revalidate = true): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (revalidate) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return fail(e);
  }
}

/** Unwrap a Supabase response, throwing its error. */
export function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
