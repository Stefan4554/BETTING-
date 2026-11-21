/**
 * LIVE odds-provider verification — real HTTP requests, no mocks.
 *
 *   THE_ODDS_API_KEY=… npm run test:live-odds              # The Odds API (/sports + one odds payload)
 *   API_FOOTBALL_KEY=… LIVE_ODDS_PROVIDER=api_football npm run test:live-odds
 *   LIVE_ODDS_SPORT=basketball_nba  (optional; default soccer_epl / league 39)
 *
 * Exit codes: 0 = verified · 1 = provider reached but failed (bad key, quota, outage, malformed)
 *             2 = NOT VERIFIED (no key, or provider unreachable from this machine)
 */
import { theOddsApi } from "../src/lib/providers/the-odds-api";
import { apiFootball } from "../src/lib/providers/api-football";

async function main() {
  const which = process.env.LIVE_ODDS_PROVIDER ?? "the_odds_api";
  const provider = which === "api_football" ? apiFootball : theOddsApi;
  const key = which === "api_football" ? process.env.API_FOOTBALL_KEY : process.env.THE_ODDS_API_KEY;
  if (!key) {
    console.log(`NOT VERIFIED: no API key in the environment for ${provider.name} (${which === "api_football" ? "API_FOOTBALL_KEY" : "THE_ODDS_API_KEY"}).`);
    process.exit(2);
  }
  const sport = process.env.LIVE_ODDS_SPORT ?? (which === "api_football" ? "39" : "soccer_epl");
  console.log(`Live check: ${provider.name}, sample ${sport} …`);
  const r = await provider.test({ apiKey: key, regions: "eu", markets: "h2h", timeoutMs: 15_000 }, { sampleSport: sport });
  for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  console.log(`  status=${r.status} reachedProvider=${r.reachedProvider} latency=${r.latencyMs}ms quota=${JSON.stringify(r.quota ?? null)}`);
  if (r.ok) { console.log(`VERIFIED: ${r.message}`); process.exit(0); }
  if (!r.reachedProvider) { console.log(`NOT VERIFIED: ${r.message}`); process.exit(2); }
  console.log(`FAILED: ${r.message}`);
  process.exit(1);
}
void main();
