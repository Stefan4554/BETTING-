/**
 * Exact decimal arithmetic for money. Mirrors PostgreSQL numeric + round(x, 2), which
 * rounds half away from zero (decimal.js ROUND_HALF_UP has the same semantics).
 * Settlement maths must go through these helpers, never through raw float arithmetic.
 */
import Decimal from "decimal.js";

export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;
export type Num = number | string | Dec;

export const d = (x: Num) => new Dec(x);
/** Round to cents, half away from zero. */
export const money = (x: Num) => new Dec(x).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
export const toNum = (x: Dec) => x.toNumber();
/** Round a float to cents and return a number (for display/analytics outputs). */
export const r2 = (x: number) => money(x).toNumber();

/** Integer cents for exact accumulation of many 2-dp values. */
export const cents = (x: number) => Math.round(x * 100);
export const fromCents = (c: number) => c / 100;
