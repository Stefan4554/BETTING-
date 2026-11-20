# Financial model

The database is the authority for money. Every operation that changes a balance is a
`SECURITY DEFINER` PostgreSQL function in `supabase/migrations/20261120000003_financial_engine.sql`
that runs in one transaction, locks the rows it changes (`SELECT … FOR UPDATE`) and writes an
audit record. Clients have **select-only** access to bets, legs, trades, executions,
transactions and bankroll balances.

The TypeScript engine in `src/lib/finance` mirrors the settlement formulas with exact decimal
arithmetic (`decimal.js`, half-away-from-zero rounding like PostgreSQL `round(x, 2)`) for form
previews and analytics. `tests/parity.db.test.ts` checks both agree on 600 randomised bets.

## Ledger

`bankroll_transactions` is append-only (a trigger rejects updates and client deletes).
`bankrolls.balance` is a cache of `Σ amount`, maintained only by `private.post_tx`;
`verify_bankroll()` recomputes it.

| Event | Transaction | Amount (bankroll currency) |
| --- | --- | --- |
| Place bet | `bet_placement` | − reservation: stake (back) or stake × (odds − 1) (lay) |
| Partial cash-out | `cashout` | + amount received |
| Settle | `bet_settlement` (one per settlement cycle — unique index) | + credit = open reservation + profit on the open part |
| Reopen | `bet_reversal` | − previous settlement credit |
| Edit pending stake/odds | `bet_reversal` + `bet_placement` | release old, reserve new |
| Delete | `bet_reversal` | − net of all the bet's transactions (row kept, `deleted_at` set) |
| Settle trade | `trade_settlement` | ± realised P&L |
| Deposit / withdrawal / adjustment | capital flow | ± amount (adjustments require a note) |
| Transfer | `transfer_out` / `transfer_in` (shared `transfer_group`) | − amount / + amount × FX |

Invariant (tested for every bankroll):
`balance = capital flows + Σ settled profit − Σ (pending reservation − pending cash-outs) + Σ trade P&L`.
Capital flows never count as profit; profit is always `bets.profit` / `trades.realized_pnl`.

Debits that would overdraw a bankroll are rejected (`INSUFFICIENT_FUNDS`) unless the bankroll
allows a negative balance.

### Derived bankroll figures

* **Current bankroll (equity)** = cash balance + stakes reserved by pending bets.
* **Available** = cash balance − worst-case loss of open trades.
* **Open exposure** = reserved stakes/liabilities + open-trade worst case.
* **Peak bankroll** = net capital + peak cumulative betting P&L.
* **Growth** = net betting profit / net capital.

## Settlement

For a back bet with open stake `S = stake − cashed_out_stake`, commission `c` and result factor `F`:

| Result | F |
| --- | --- |
| won | odds |
| half_won | (1 + odds) / 2 |
| void | 1 |
| half_lost | ½ |
| lost | 0 |

`gross = S × (F − 1)`; commission applies only when `gross > 0`: `gross × (1 − c)`.
`profit = round(gross, 2) + (cashout_amount − cashed_out_stake)`.
Full cash-out: `profit = Σ cash-outs − stake`.

**Accumulators:** odds = Π leg odds; `F = Π leg factors`. Any lost leg loses the bet (even with
other legs pending); all-void → void (stake back); otherwise the bet is `won` with payout
`stake × F` (so a half-lost leg can return less than the stake).

**Lay bets:** liability `L = stake × (odds − 1)` is reserved. Won (selection lost):
`stake × (1 − c)`; half won: `stake/2 × (1 − c)`; lost: `−L`; half lost: `−L/2`. Lay bets cannot be
cashed out (hedge with a trade instead).

**Asian handicap / quarter lines:** a ±x.25 / ±x.75 line is split into two half stakes on the
neighbouring lines; each half wins, pushes or loses → won / half_won / void / half_lost / lost
(`asianHandicapResult`, `totalsResult`).

**Double settlement** is impossible: the settle function locks the bet, requires `pending`, and the
ledger has a unique index on `(bet_id, settlement_seq)`.

**Multiple currencies:** a bet in a currency different from its bankroll locks `fx_rate` at
placement (from the stored snapshot on or before the placement date, or an explicit rate). All
bankroll postings use that rate. Analytics convert bankroll currency → display currency with the
historical snapshot on the bet's placement date; bets without a rate are excluded and counted.

## Trading

For executions on one selection: `Bs` back stakes, `Bw = Σ back s(o−1)`, `Lw = Σ lay s(o−1)`,
`Ls` lay stakes, `Cs` back stake closed by cash-outs, `Ca` cash-out received:

* if win  = `Bw × (1 − Cs/Bs) − Lw + (Ca − Cs)`
* if lose = `−(Bs − Cs) + Ls + (Ca − Cs)`
* exposure = `max(0, −min(if win, if lose))`
* settlement: commission on positive net P&L.
* green-up: long → lay `(win − lose) / lay odds`; short → back `(lose − win) / back odds`;
  unrealised P&L = the locked P&L of that hedge at the current price.

## Metrics (`src/lib/finance/metrics.ts`)

| Metric | Definition |
| --- | --- |
| ROI = Yield | net profit / total settled stake (both labels shown, identical by design) |
| Win rate | wins / settled non-void bets (won, half won, profitable cash-outs are wins) |
| Profit factor | gross winning profit / \|gross losing profit\| (no losses → “∞”, no wins → 0) |
| Average odds | mean odds of settled non-void selections |
| EV | `stake × [p(odds − 1) − (1 − p)]`, back bets with an estimate only |
| Expected ROI | Σ EV / Σ stake of those bets (compared with realised ROI on the same bets) |
| Edge | estimated p − 1/odds |
| CLV (odds) | taken / closing − 1 |
| CLV (probability) | closing implied − entry implied (pp). Lay bets flip sign |
| Sharpe / Sortino | per-bet mean return / std (or downside deviation) of `profit / stake`; not annualised |
| Max drawdown | on the cumulative betting P&L path; % relative to capital + peak P&L |
| Recovery factor | net profit / max drawdown |
| Streaks | voids neither extend nor break a streak |
| Risk of ruin | `exp(−2 μ B / σ²)` (μ, σ² per-bet P&L, B equity); needs ≥ 30 settled bets; 1 if μ ≤ 0 |
| Calibration | Brier, log loss, 10 buckets with 95% Wilson intervals, Brier skill vs implied odds; won/lost back bets with estimates only |

Edge cases return `null` (rendered “—”) rather than a misleading number: no settled bets, zero
stake, no losses/wins, invalid odds (rejected at entry and in the database), missing closing odds
(excluded from CLV with the sample size shown). Fewer than 30 settled bets show a small-sample
warning.

## Risk

Exposure is aggregated per event (same event regardless of spelling/case), sport, league, market,
bookmaker, bankroll and manual correlation group; bets are not assumed independent. Limits warn at
80% and are critical above 100%. With *enforce* on, `place_bet` rejects bets breaching max stake,
max % of bankroll, max event exposure or max total exposure (`RISK_LIMIT:` errors).

## Arbitrage

Effective odds `o' = 1 + (o − 1)(1 − c)`. Arb when `Σ 1/o'ᵢ < 1` over all outcomes. Stake on
outcome i = `T × (1/o'ᵢ) / Σ 1/o'`, equalising returns; the whole position scales down to respect
the tightest max stake; per-leg FX supported. Always labelled theoretical.
