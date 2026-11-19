import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { env } from "./env";

/**
 * Simple fixed-window rate limiter, per client IP and route.
 * In-memory = per server instance. For multi-instance production use a shared
 * store (e.g. Upstash Redis) — see docs/DEPLOYMENT.md.
 */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(req: NextRequest, route: string, limit = 60, windowMs = 60_000): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  w.count++;
  if (w.count > limit) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(Math.ceil((w.start + windowMs - now) / 1000)) } });
  }
  return null;
}

export function apiError(e: unknown) {
  if (e instanceof ZodError) return NextResponse.json({ error: "invalid_input", issues: e.issues }, { status: 400 });
  console.error("[api]", e);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function assertCron(req: NextRequest): NextResponse | null {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
