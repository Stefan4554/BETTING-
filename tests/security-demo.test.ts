import { describe, expect, it, beforeAll } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { decryptSecret, encryptSecret, last4 } from "@/lib/server/crypto";
import { buildDemoDataset } from "@/lib/demo/generator";

describe("API key encryption", () => {
  beforeAll(() => { process.env.API_KEY_ENCRYPTION_KEY = "11".repeat(32); resetEnvCache(); });
  it("round-trips and never stores plaintext", () => {
    const c = encryptSecret("my-secret-key-123");
    expect(c).not.toContain("my-secret");
    expect(decryptSecret(c)).toBe("my-secret-key-123");
    expect(encryptSecret("x")).not.toBe(encryptSecret("x")); // random IV
  });
  it("detects tampering", () => {
    const c = Buffer.from(encryptSecret("abcdefgh"), "base64");
    c[c.length - 1] = c[c.length - 1]! ^ 1;
    expect(() => decryptSecret(c.toString("base64"))).toThrow();
  });
  it("masks keys", () => expect(last4("abcdef1234")).toBe("1234"));
});

describe("demo dataset", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const d = buildDemoDataset(now);
  it("is deterministic", () => expect(JSON.stringify(buildDemoDataset(now))).toBe(JSON.stringify(d)));
  it("covers football, tennis, basketball, live & pre-match, singles & accumulators", () => {
    const sports = new Set(d.bets.map((b) => b.sport_key));
    expect([...sports]).toEqual(expect.arrayContaining(["football", "tennis", "basketball"]));
    expect(d.bets.some((b) => b.is_live)).toBe(true);
    expect(d.bets.some((b) => !b.is_live)).toBe(true);
    expect(d.bets.some((b) => Array.isArray(b.legs))).toBe(true);
    expect(d.bets.some((b) => b.status === "pending")).toBe(true);
    expect(new Set(d.bets.map((b) => b.bookmaker_key)).size).toBeGreaterThan(3);
    expect(d.trades.length).toBeGreaterThan(10);
  });
  it("uses only fictional names and labels simulated prices", () => {
    expect(d.events.every((e) => !/Arsenal|Chelsea|Real Madrid|Lakers/.test(String(e.name)))).toBe(true);
    expect(d.bets.filter((b) => b.closing_odds).every((b) => b.closing_source === "demo:simulated")).toBe(true);
  });
  it("simulated books keep a positive margin except the one deliberate price error", () => {
    let negative = 0;
    for (const e of d.events) for (const m of e.markets as { snapshots: { bookmaker: string; selection: string; odds: number; at: string }[] }[]) {
      const byBook = new Map<string, Map<string, number>>();
      for (const s of m.snapshots) { if (s.at !== m.snapshots.at(-1)!.at) continue; (byBook.get(s.bookmaker) ?? byBook.set(s.bookmaker, new Map()).get(s.bookmaker)!).set(s.selection, s.odds); }
      for (const [, sel] of byBook) if ([...sel.values()].reduce((a, o) => a + 1 / o, 0) < 1) negative++;
    }
    expect(negative).toBeLessThanOrEqual(1);
  });
});
