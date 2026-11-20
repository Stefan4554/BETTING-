/**
 * Currency conversion with historical snapshots. A rate is "1 base = rate quote".
 * Conversion uses the latest snapshot on or before the given date; inverse pairs are
 * used when only the opposite direction is stored. Missing rates return null — the UI
 * then shows the amount unconverted with a warning instead of guessing.
 */
export interface FxRate { base: string; quote: string; rate: number; asOf: string }

export class FxTable {
  private byPair = new Map<string, FxRate[]>();
  constructor(rates: FxRate[]) {
    for (const r of rates) {
      const k = `${r.base}/${r.quote}`;
      (this.byPair.get(k) ?? this.byPair.set(k, []).get(k)!).push(r);
    }
    for (const list of this.byPair.values()) list.sort((a, b) => a.asOf.localeCompare(b.asOf));
  }

  private find(base: string, quote: string, date: string): FxRate | null {
    const list = this.byPair.get(`${base}/${quote}`);
    if (!list) return null;
    let found: FxRate | null = null;
    for (const r of list) { if (r.asOf <= date) found = r; else break; }
    return found;
  }

  rate(from: string, to: string, date: string = new Date().toISOString().slice(0, 10)): number | null {
    if (from === to) return 1;
    const day = date.slice(0, 10);
    const direct = this.find(from, to, day);
    const inverse = this.find(to, from, day);
    if (direct && (!inverse || direct.asOf >= inverse.asOf)) return direct.rate;
    if (inverse) return 1 / inverse.rate;
    // Triangulate through EUR (the ECB feed publishes EUR crosses).
    if (from !== "EUR" && to !== "EUR") {
      const a = this.rate(from, "EUR", day);
      const b = this.rate("EUR", to, day);
      if (a != null && b != null) return a * b;
    }
    return null;
  }

  convert(amount: number, from: string, to: string, date?: string): number | null {
    const r = this.rate(from, to, date);
    return r == null ? null : amount * r;
  }
}
