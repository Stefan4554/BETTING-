import { describe, expect, it } from "vitest";
import { guessMapping, mapRow } from "@/lib/import-map";
import { csvCell, toCsv } from "@/lib/export";

describe("import mapping", () => {
  const headers = ["Date", "Match", "Pick", "Odds", "Stake", "Result", "Bookmaker", "Prob", "Closing"];
  const m = guessMapping(headers);
  it("guesses columns from common header names", () => {
    expect(m).toMatchObject({ placed_at: "Date", event_name: "Match", selection: "Pick", odds: "Odds", stake: "Stake", status: "Result", bookmaker: "Bookmaker", est_probability: "Prob", closing_odds: "Closing" });
  });
  it("normalises a valid row", () => {
    const r = mapRow({ Date: "01/03/2026 15:30", Match: "A v B", Pick: "A", Odds: "5/2", Stake: "€25,50", Result: "W", Bookmaker: "Pinnacle", Prob: "45%", Closing: "+140" }, m, 2);
    expect(r.errors).toEqual([]);
    expect(r.payload).toMatchObject({ placed_at: "2026-03-01T15:30:00.000Z", odds: 3.5, stake: 25.5, status: "won", est_probability: 0.45, closing_odds: 2.4 });
  });
  it("reports every problem in a bad row", () => {
    const r = mapRow({ Date: "nope", Match: "", Pick: "", Odds: "0.5", Stake: "-1", Result: "maybe", Prob: "150" }, m, 7);
    expect(r.errors).toEqual(expect.arrayContaining(["invalid date", "event missing", "selection missing", "invalid odds", "invalid stake", 'unknown status "maybe"', "invalid probability"]));
    expect(r.row).toBe(7);
  });
  it("cash-outs need an amount", () => {
    const mm = { ...m, cashout_amount: "Cash" };
    expect(mapRow({ Date: "2026-01-01", Match: "x", Pick: "y", Odds: "2", Stake: "1", Result: "cashed out" }, mm, 2).errors).toContain("cash-out amount missing");
  });
});

describe("CSV export safety", () => {
  it("neutralises formula injection but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-3)).toBe("-3");
  });
  it("quotes separators and newlines", () => {
    expect(toCsv(["a", "b"], [["x,y", "line\nbreak"]])).toBe('a,b\r\n"x,y","line\nbreak"');
  });
});
