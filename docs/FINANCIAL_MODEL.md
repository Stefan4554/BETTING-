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
| Trade execution (open / add / hedge) | `trade_reservation` | − more held or + released, to keep the reservation = worst case still at risk |
| Trade partial close (cash-out) | `trade_reservation` + `trade_cashout` | + release of the closed part, ± realised P/L (amount − stake closed) |
| Trade final close | `trade_settlement` (always posted, may be 0) | reserved + total P/L − already realised |
| Deposit / withdrawal / adjustment | capital flow | ± amount (adjustments require a note) |
| Transfer | `transfer_out` / `transfer_in` (shared `transfer_group`) | − amount / + amount × FX |

Invariant (tested for every bankroll):
`balance = capital flows + Σ settled bet profit − Σ (pending bet reservation − pending cash-outs) + Σ closed trade P&L + Σ open trades (realised partial − reserved)`.
Capital flows never count as profit; profit is always `bets.profit` / `trades.realized_pnl`.

Debits that would overdraw a bankroll are rejected (`INSUFFICIENT_FUNDS`) unless the bankroll
allows a negative balance.

### Derived bankroll figures

* **Available bankroll** = ledger cash balance (reservations are already deducted, never expensed).
* **Reserved bankroll** = Σ pending-bet reservations + Σ open-trade reservations (`trades.reserved_base`).
* **Total bankroll** = available + reserved.
* **Open exposure** = reserved total. **Realised P/L** includes partial closes; **unrealised** P/L is
  the green-up value at current prices (Live Trading).
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

**Accumulators:** odds = Π leg odds; payout = open stake × Π leg factors (a half result splits the
running stake: half rides on at the leg odds / is lost, half is returned at 1.00 — `accumulatorComponents`
lists those paths, which sum to the product). The result is derived from the **actual payout**,
never from leg labels: any lost leg → `lost`; every leg void → `void`; all non-void legs fully won →
`won`; otherwise payout > stake → `partial_win`, payout = stake → `break_even`, payout < stake →
`partial_loss`. Net P&L = payout − stake (commission on positive winnings). Leg results can be
recorded one at a time (`set_leg_results`); the bet settles when a leg loses or all legs are decided.
Win rate counts partial wins/losses by the sign of P/L; void and break-even are neither.

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
* reservation = `max(0, −min(win_open, lose_open))` where the *open* scenarios exclude already realised
  partial closes; every execution moves the ledger reservation to that level (insufficient funds are
  rejected), a cash-out also posts its realised P/L, and the final close posts
  `reserved + total P/L − realised`. The postings of a closed trade always sum to its realised P/L.
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
| Sharpe / Sortino | three frequencies (`risk-adjusted.ts`): **per bet** (r = profit/stake), **daily** (r = daily P/L ÷ equity at start of day, every calendar day from first to last settlement in the user's time zone, zero-filled), **annualised** = daily × √P (P = 365 or 252; 252 rolls weekend P/L into Monday). Sharpe uses excess return over the risk-free rate, Sortino the downside deviation below the MAR (both annual settings converted per period). Withheld with a reason below 30 bets (per bet), 30 days / 20 active days (daily), 90 days and ≥ 10 % active days (annualised), zero volatility, no downside, no capital base |
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

## Dates

Every KPI, chart, table and report uses one **date basis**, chosen globally (top bar) or per report:
bet placed date, event start date, or settlement date. Ranges are half-open `[from, to)` instants
built from local midnights in the user's IANA time zone (DST-safe). Bets without an event date fall
back to their placement date under the event basis (counted and shown); pending bets have no
settlement date and are excluded from dated ranges under the settlement basis. Presets: today,
yesterday, last 7/30/90 days, this month, last month, this year, all time, custom.
Risk-adjusted metrics always use settlement dates (they measure realised returns over time).
