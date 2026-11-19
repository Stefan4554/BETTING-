import Link from "next/link";
import { getModel, getPredictions, getSnapshot } from "@/lib/data/service";
import { fmtNum, fmtPct, fmtTime, SURFACE_LABEL } from "@/lib/format";
import { EmptyState, MatchLabel, Notices, PageHeader, Panel, ProbBar, StatTile, StatusPill } from "@/components/terminal/primitives";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { CalibrationChart } from "@/components/charts/charts";
import { DEFAULT_ELO } from "@/lib/engine/elo";

export const metadata = { title: "Predictions" };

export default async function PredictionsPage() {
  const [snap, preds, model] = await Promise.all([getSnapshot(), getPredictions(), getModel()]);
  const r = model.report;
  return (
    <>
      <PageHeader title="Prediction engine" description="Surface-adjusted Elo (K = 250/(n+5)^0.4, 50% surface blend). Walk-forward evaluated on a chronological 80/20 split: each test match is predicted before its result updates the ratings, so no leakage." />
      <Notices notices={snap.notices} />
      {model.note && <Panel><EmptyState icon="info" title="Model not trained">{model.note}</EmptyState></Panel>}
      {r && (
        <>
          <Panel title="Model performance" subtitle={`elo-surface-v1 · trained through ${model.trainedThrough?.slice(0, 10)}`} bodyClassName="grid grid-cols-3 md:grid-cols-7">
            <StatTile label="Brier score" value={r.brier.toFixed(4)} sub="lower is better · 0.25 = coin flip" />
            <StatTile label="Log loss" value={r.logLoss.toFixed(4)} sub="0.693 = coin flip" />
            <StatTile label="Accuracy" value={fmtPct(r.accuracy)} sub="favourite picked" />
            <StatTile label="Calibration error" value={fmtPct(r.ece, 2)} sub="ECE, 10 bins" />
            <StatTile label="Train matches" value={fmtNum(r.trainSize)} />
            <StatTile label="Test matches" value={fmtNum(r.predicted)} sub={`${r.skippedInsufficientData} skipped: thin history`} />
            <StatTile label="Min history" value={DEFAULT_ELO.minMatches} sub="matches per player" />
          </Panel>
          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Calibration" subtitle="forecast vs observed (test set)"><div className="p-2"><CalibrationChart data={r.calibration} /></div></Panel>
            <Panel title="Calibration table" className="xl:col-span-2">
              <Table>
                <THead><TR><TH>Bin</TH><TH className="text-right">Matches</TH><TH className="text-right">Mean forecast</TH><TH className="text-right">Observed</TH><TH className="text-right">Gap</TH></TR></THead>
                <tbody>{r.calibration.filter((b) => b.count).map((b) => (
                  <TR key={b.lower}><TD className="num">{fmtPct(b.lower, 0)}–{fmtPct(b.upper, 0)}</TD><TD className="num text-right">{b.count}</TD><TD className="num text-right">{fmtPct(b.meanForecast)}</TD><TD className="num text-right">{fmtPct(b.observedRate)}</TD><TD className={`num text-right ${Math.abs(b.observedRate - b.meanForecast) > 0.05 ? "text-warn" : "text-muted"}`}>{fmtPct(b.observedRate - b.meanForecast, 1, true)}</TD></TR>
                ))}</tbody>
              </Table>
            </Panel>
          </div>
        </>
      )}
      <Panel title="Pre-match win probabilities" subtitle="≈90% interval is a heuristic from sample size, not a calibrated posterior">
        <Table>
          <THead><TR><TH>Time</TH><TH>Match</TH><TH>Surface</TH><TH>Status</TH><TH>P(A) / P(B)</TH><TH className="text-right">Interval A</TH><TH>Predicted winner</TH><TH className="text-right">History A / B</TH><TH>Note</TH></TR></THead>
          <tbody>
            {snap.matches.map((m) => {
              const p = preds.find((x) => x.matchId === m.id);
              const pr = p?.prediction;
              return (
                <TR key={m.id}>
                  <TD className="num text-muted">{fmtTime(m.scheduledAt)}</TD>
                  <TD className="max-w-60"><MatchLabel m={m} /></TD>
                  <TD className="text-muted">{SURFACE_LABEL[m.surface]}</TD>
                  <TD><StatusPill status={m.status} /></TD>
                  <TD><ProbBar a={pr?.probA ?? null} /></TD>
                  <TD className="num text-right text-muted">{pr ? `${fmtPct(pr.ciLow, 0)}–${fmtPct(pr.ciHigh, 0)}` : "—"}</TD>
                  <TD>{pr ? (pr.probA >= 0.5 ? m.playerA.name : m.playerB.name) : "—"}{pr && m.winner && <span className={`ml-1 text-[10.5px] ${(pr.probA >= 0.5) === (m.winner === "a") ? "text-up" : "text-down"}`}>{(pr.probA >= 0.5) === (m.winner === "a") ? "✓" : "✗"}</span>}</TD>
                  <TD className="num text-right text-muted">{pr ? `${pr.sampleA} / ${pr.sampleB}` : "—"}</TD>
                  <TD className="max-w-72 truncate text-[11px] text-dim">{p?.reason ?? ""}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <p className="text-[11px] text-dim">Planned model components (phase 2): recent-form model, serve/return model from point-level stats, fatigue features, and an ensemble with stacked calibration. See <Link href="/api-management" className="text-accent">API management</Link> for the data each requires.</p>
    </>
  );
}
