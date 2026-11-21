-- BETTING EDGE PRO — 0007 enum extensions (separate migration: new enum values must be
-- committed before they can be used by the functions in 0008).

-- Live-trading reservation accounting.
alter type tx_type add value if not exists 'trade_reservation';   -- hold (−) / release (+) of open-trade exposure
alter type tx_type add value if not exists 'trade_cashout';       -- realised P/L of a partial close

-- Accumulator results derived from the actual payout.
alter type bet_status add value if not exists 'partial_win';      -- payout > stake with half-results in the legs
alter type bet_status add value if not exists 'partial_loss';     -- 0 < payout < stake
alter type bet_status add value if not exists 'break_even';       -- payout = stake (not all legs void)
