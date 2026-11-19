/**
 * Live win probability via a hierarchical Markov model of tennis
 * (point → game → tiebreak → set → match), assuming i.i.d. points on serve.
 *
 * Serve-point probabilities are calibrated so that the model reproduces the
 * pre-match probability at 0-0, then the current score is plugged in.
 * This is a standard textbook model (e.g. Klaassen & Magnus); it does not
 * capture momentum or injury — the UI labels it as model-based.
 */

/** P(server wins game) from point score (server points, receiver points). */
export function gameWinProb(p: number, a = 0, b = 0): number {
  const q = 1 - p;
  const deuce = (p * p) / (p * p + q * q);
  const memo = new Map<string, number>();
  const rec = (x: number, y: number): number => {
    if (x >= 4 && x - y >= 2) return 1;
    if (y >= 4 && y - x >= 2) return 0;
    if (x >= 3 && y >= 3) {
      if (x === y) return deuce;
      return x > y ? p + q * deuce : p * deuce;
    }
    const k = `${x},${y}`;
    if (!memo.has(k)) memo.set(k, p * rec(x + 1, y) + q * rec(x, y + 1));
    return memo.get(k)!;
  };
  return rec(a, b);
}

/**
 * P(A wins tiebreak). pa = A wins point on own serve, pb = B wins point on own serve.
 * `aServesFirst` = A served the first point of the tiebreak.
 */
export function tiebreakWinProb(pa: number, pb: number, a = 0, b = 0, aServesFirst = true, target = 7): number {
  const memo = new Map<string, number>();
  const pAwinOn = (pointIndex: number) => {
    // Serve order: 1 point, then alternate every 2 points.
    const aServing = (Math.floor((pointIndex + 1) / 2) % 2 === 0) === aServesFirst;
    return aServing ? pa : 1 - pb;
  };
  const rec = (x: number, y: number): number => {
    if (x >= target && x - y >= 2) return 1;
    if (y >= target && y - x >= 2) return 0;
    if (x >= target - 1 && y >= target - 1 && x === y) {
      // Two-point cycles from level: one serve each.
      const w = pa * (1 - pb);
      const l = (1 - pa) * pb;
      return w / (w + l);
    }
    const k = `${x},${y}`;
    if (!memo.has(k)) {
      const pw = pAwinOn(x + y);
      memo.set(k, pw * rec(x + 1, y) + (1 - pw) * rec(x, y + 1));
    }
    return memo.get(k)!;
  };
  return rec(a, b);
}

/** P(A wins set) from games (ga, gb) with `aServing` = A serves the next game. */
export function setWinProb(pa: number, pb: number, ga = 0, gb = 0, aServing = true): number {
  const holdA = gameWinProb(pa);
  const holdB = gameWinProb(pb);
  const memo = new Map<string, number>();
  const rec = (x: number, y: number, aSrv: boolean): number => {
    if ((x >= 6 && x - y >= 2) || x === 7) return 1;
    if ((y >= 6 && y - x >= 2) || y === 7) return 0;
    if (x === 6 && y === 6) return tiebreakWinProb(pa, pb, 0, 0, aSrv);
    const k = `${x},${y},${aSrv}`;
    if (!memo.has(k)) {
      const g = aSrv ? holdA : 1 - holdB;
      memo.set(k, g * rec(x + 1, y, !aSrv) + (1 - g) * rec(x, y + 1, !aSrv));
    }
    return memo.get(k)!;
  };
  return rec(ga, gb, aServing);
}

/** P(A wins match) from sets won. Server at the start of future sets is averaged. */
export function matchWinProbFromSets(pa: number, pb: number, sa: number, sb: number, bestOf: 3 | 5): number {
  const need = bestOf === 5 ? 3 : 2;
  const s = (setWinProb(pa, pb, 0, 0, true) + setWinProb(pa, pb, 0, 0, false)) / 2;
  const memo = new Map<string, number>();
  const rec = (x: number, y: number): number => {
    if (x >= need) return 1;
    if (y >= need) return 0;
    const k = `${x},${y}`;
    if (!memo.has(k)) memo.set(k, s * rec(x + 1, y) + (1 - s) * rec(x, y + 1));
    return memo.get(k)!;
  };
  return rec(sa, sb);
}

const POINTS: Record<string, number> = { "0": 0, "15": 1, "30": 2, "40": 3, A: 4, AD: 4 };

export interface LiveState {
  bestOf: 3 | 5;
  /** Completed sets plus the current set (last element), as games. */
  sets: { a: number; b: number }[];
  game: { a: string; b: string } | null;
  server: "a" | "b" | null;
}

function isSetComplete(s: { a: number; b: number }) {
  return (s.a >= 6 && s.a - s.b >= 2) || (s.b >= 6 && s.b - s.a >= 2) || s.a === 7 || s.b === 7;
}

/** P(A wins match) from the current live state. */
export function liveWinProb(pa: number, pb: number, st: LiveState): number {
  const done = st.sets.filter(isSetComplete);
  const current = st.sets.find((s) => !isSetComplete(s)) ?? { a: 0, b: 0 };
  const sa = done.filter((s) => s.a > s.b).length;
  const sb = done.length - sa;
  const need = st.bestOf === 5 ? 3 : 2;
  if (sa >= need) return 1;
  if (sb >= need) return 0;

  const aSrv = st.server !== "b";
  let pSet: number;
  if (current.a === 6 && current.b === 6) {
    const x = st.game ? parseInt(st.game.a, 10) || 0 : 0;
    const y = st.game ? parseInt(st.game.b, 10) || 0 : 0;
    // Approximation: treat the current server as having served first in the tiebreak.
    pSet = tiebreakWinProb(pa, pb, x, y, aSrv);
  } else if (st.game && st.server) {
    const x = POINTS[st.game.a.toUpperCase()] ?? 0;
    const y = POINTS[st.game.b.toUpperCase()] ?? 0;
    const pGame = aSrv ? gameWinProb(pa, x, y) : 1 - gameWinProb(pb, y, x);
    pSet = pGame * setWinProb(pa, pb, current.a + 1, current.b, !aSrv) + (1 - pGame) * setWinProb(pa, pb, current.a, current.b + 1, !aSrv);
  } else {
    pSet = setWinProb(pa, pb, current.a, current.b, aSrv);
  }
  return pSet * matchWinProbFromSets(pa, pb, sa + 1, sb, st.bestOf) + (1 - pSet) * matchWinProbFromSets(pa, pb, sa, sb + 1, st.bestOf);
}

/**
 * Find serve-point probabilities consistent with a pre-match win probability.
 * `base` is the tour-average serve-point win rate (≈0.64 ATP, ≈0.56 WTA).
 */
export function calibrateServe(preMatchA: number, bestOf: 3 | 5, base = 0.62): { pa: number; pb: number } {
  let lo = -0.3, hi = 0.3;
  for (let i = 0; i < 60; i++) {
    const d = (lo + hi) / 2;
    const v = matchWinProbFromSets(base + d, base - d, 0, 0, bestOf);
    if (v < preMatchA) lo = d;
    else hi = d;
  }
  const d = (lo + hi) / 2;
  return { pa: base + d, pb: base - d };
}
