/**
 * Parity between the TypeScript settlement engine and the authoritative SQL functions.
 * Runs only when DATABASE_URL points at a database with the migrations applied
 * (CI database job, or the local Supabase stack). Skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { betProfit, liability, potentialPayout, type BetStatus } from "@/lib/finance/settlement";
import { position, tradeLedger, type Execution } from "@/lib/finance/trading";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("TS ↔ SQL parity", () => {
  let db: pg.Client;
  beforeAll(async () => { db = new pg.Client({ connectionString: url }); await db.connect(); });
  afterAll(async () => { await db?.end(); });

  // Deterministic pseudo-random grid
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const statuses: BetStatus[] = ["won", "lost", "void", "half_won", "half_lost", "cashed_out"];
  const cases = Array.from({ length: 600 }, () => {
    const side = rnd() < 0.25 ? "lay" : "back";
    const odds = Math.round((1.01 + rnd() * 15) * 1000) / 1000;
    const stake = Math.round((0.1 + rnd() * 900) * 100) / 100;
    const commission = rnd() < 0.5 ? 0 : [0.02, 0.05, 0.065][Math.floor(rnd() * 3)]!;
    let status = statuses[Math.floor(rnd() * statuses.length)]!;
    if (side === "lay" && status === "cashed_out") status = "won";
    const partial = side === "back" && status !== "cashed_out" && rnd() < 0.3;
    const cashedOutStake = status === "cashed_out" ? stake : partial ? Math.round(stake * rnd() * 0.9 * 100) / 100 : 0;
    const cashoutAmount = status === "cashed_out" || partial ? Math.round(rnd() * stake * 2 * 100) / 100 : 0;
    return { side, odds, stake, commission, status, cashedOutStake, cashoutAmount } as const;
  });

  it("bet_profit matches for 600 random bets", async () => {
    const { rows } = await db.query(
      `select private.bet_profit(c.side::bet_side, c.odds, c.stake, c.commission, c.status::bet_status, c.cos, c.ca)::text as p,
              private.bet_liability(c.side::bet_side, c.odds, c.stake)::text as l,
              private.bet_potential_payout(c.side::bet_side, c.odds, c.stake, c.commission)::text as pp
         from jsonb_to_recordset($1::jsonb) as c(side text, odds numeric, stake numeric, commission numeric, status text, cos numeric, ca numeric)`,
      [JSON.stringify(cases.map((c) => ({ ...c, cos: c.cashedOutStake, ca: c.cashoutAmount })))],
    );
    const mismatches = cases.flatMap((c, i) => {
      const ts = betProfit(c)!.toFixed(2);
      const sql = Number(rows[i].p).toFixed(2);
      const tl = liability(c.side, c.odds, c.stake).toFixed(2);
      const tp = potentialPayout(c.side, c.odds, c.stake, c.commission).toFixed(2);
      return ts !== sql || tl !== Number(rows[i].l).toFixed(2) || tp !== Number(rows[i].pp).toFixed(2) ? [{ c, ts, sql }] : [];
    });
    expect(mismatches).toEqual([]);
  });

  it("leg factors match", async () => {
    const { rows } = await db.query(
      `select s, private.leg_factor(s, 2.75)::text as f from unnest(array['won','half_won','void','half_lost','lost']) s`,
    );
    expect(rows.map((r) => Number(r.f))).toEqual([2.75, 1.875, 1, 0.5, 0]);
  });

  it("trade P/L matches", async () => {
    await db.query("begin");
    try {
      const u = "cccccccc-0000-0000-0000-000000000003";
      await db.query("insert into auth.users (id, email) values ($1, 'parity@test.local')", [u]);
      const br = (await db.query("select id from bankrolls where user_id = $1", [u])).rows[0].id;
      const sport = (await db.query("select id from sports where key = 'football' and owner_id is null")).rows[0].id;
      const t = (await db.query(
        "insert into trades (user_id, bankroll_id, sport_id, event_name, market, selection, currency) values ($1,$2,$3,'x','m','s','EUR') returning id",
        [u, br, sport])).rows[0].id;
      const ex = [
        { side: "back", odds: 3.25, stake: 40 }, { side: "back", odds: 2.9, stake: 25.5 },
        { side: "lay", odds: 2.2, stake: 60 }, { side: "cashout", stake: 20, amount: 31.4 },
      ] as const;
      for (const e of ex) {
        await db.query("insert into trade_executions (trade_id, side, odds, stake, amount) values ($1, $2, $3, $4, $5)",
          [t, e.side, "odds" in e ? e.odds : null, e.stake, "amount" in e ? e.amount : null]);
      }
      const { rows } = await db.query("select private.trade_pnl($1, 'win')::numeric as w, private.trade_pnl($1, 'lose')::numeric as l", [t]);
      const p = position(ex.map((e) => ({ ...e })));
      expect(Number(Number(rows[0].w).toFixed(2))).toBe(p.ifWin);
      expect(Number(Number(rows[0].l).toFixed(2))).toBe(p.ifLose);
    } finally {
      await db.query("rollback");
    }
  });

  it("trade reservation ledger postings match the TypeScript model", async () => {
    await db.query("begin");
    try {
      const u = "cccccccc-0000-0000-0000-000000000004";
      await db.query("insert into auth.users (id, email) values ($1, 'parity-trade@test.local')", [u]);
      const br = (await db.query("select id from bankrolls where user_id = $1", [u])).rows[0].id;
      await db.query("select private.post_tx($1, $2, 'deposit', 5000)", [u, br]);
      const sport = (await db.query("select id from sports where key = 'football' and owner_id is null")).rows[0].id;
      const scenarios: { ex: Execution[]; outcome: "win" | "lose" | "void"; c: number }[] = [
        { ex: [{ side: "back", odds: 3.2, stake: 75 }, { side: "lay", odds: 2.1, stake: 110 }], outcome: "win", c: 0.05 },
        { ex: [{ side: "lay", odds: 5.5, stake: 40 }, { side: "back", odds: 7, stake: 20 }], outcome: "lose", c: 0.02 },
        { ex: [{ side: "back", odds: 4, stake: 100 }, { side: "cashout", stake: 30, amount: 55.5 }, { side: "lay", odds: 2.6, stake: 80 }], outcome: "win", c: 0.05 },
        { ex: [{ side: "back", odds: 2.4, stake: 50 }, { side: "cashout", stake: 50, amount: 12.4 }], outcome: "void", c: 0 },
      ];
      for (const sc of scenarios) {
        const t = (await db.query("insert into trades (user_id, bankroll_id, sport_id, event_name, market, selection, currency, commission) values ($1,$2,$3,'p','m','s','EUR',$4) returning id", [u, br, sport, sc.c])).rows[0].id;
        for (const e of sc.ex) await db.query("select private.add_trade_execution($1, $2, $3::execution_side, $4, $5, $6)", [u, t, e.side, e.odds ?? null, e.stake, e.amount ?? null]);
        await db.query("select private.settle_trade($1, $2, $3::trade_outcome)", [u, t, sc.outcome]);
        const { rows } = await db.query("select amount::float as amount from bankroll_transactions where trade_id = $1 order by id", [t]);
        const ts = tradeLedger(sc.ex, sc.outcome, sc.c).postings.map((p) => p.amount);
        expect(rows.map((r) => r.amount)).toEqual(ts);
      }
    } finally {
      await db.query("rollback");
    }
  });
});
