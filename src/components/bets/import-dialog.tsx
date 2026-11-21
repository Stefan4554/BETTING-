"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Papa from "papaparse";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Label, Select } from "@/components/ui/input";
import { useAppData } from "@/components/app/app-data";
import { importBets } from "@/app/actions/bets";
import { FIELDS, guessMapping, mapRow, type Raw } from "@/lib/import-map";
import { downloadBlob, toCsv } from "@/lib/export";

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const app = useAppData();
  const router = useRouter();
  const [rows, setRows] = React.useState<Raw[]>([]);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [bankroll, setBankroll] = React.useState(app.defaultBankrollId ?? app.bankrolls[0]?.id ?? "");
  const [skipDup, setSkipDup] = React.useState(true);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<{ inserted: number; duplicates: number; errors: { row: number; message: string }[] } | null>(null);
  const [fileName, setFileName] = React.useState("");

  const reset = () => { setRows([]); setHeaders([]); setMapping({}); setResult(null); setProgress(null); setFileName(""); };
  const onFile = async (f: File) => {
    reset(); setFileName(f.name);
    let data: Raw[] = [];
    if (/\.xlsx?$/i.test(f.name)) {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) return toast.error("Workbook has no sheets");
      const hdr: string[] = [];
      ws.getRow(1).eachCell((c, i) => { hdr[i] = String(c.text).trim(); });
      ws.eachRow((r, n) => {
        if (n === 1) return;
        const o: Raw = {};
        r.eachCell({ includeEmpty: true }, (c, i) => { if (hdr[i]) o[hdr[i]!] = c.value instanceof Date ? c.value.toISOString() : String(c.text ?? ""); });
        if (Object.values(o).some((v) => v)) data.push(o);
      });
    } else {
      const text = await f.text();
      const parsed = Papa.parse<Raw>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
      if (parsed.errors.length) toast.warning(`${parsed.errors.length} CSV parse warning(s); first: ${parsed.errors[0]!.message}`);
      data = parsed.data;
    }
    if (!data.length) return toast.error("No rows found");
    const hs = Object.keys(data[0]!);
    setRows(data); setHeaders(hs); setMapping(guessMapping(hs));
  };

  const mapped = React.useMemo(() => rows.map((r, i) => mapRow(r, mapping, i + 2)), [rows, mapping]);
  const valid = mapped.filter((m) => !m.errors.length);
  const invalid = mapped.filter((m) => m.errors.length);
  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key] && !(f.key === "event_name" && mapping.home && mapping.away));

  const run = async () => {
    const CHUNK = 400;
    const total = { inserted: 0, duplicates: 0, errors: [] as { row: number; message: string }[] };
    setProgress(0);
    for (let i = 0; i < valid.length; i += CHUNK) {
      const r = await importBets(bankroll, valid.slice(i, i + CHUNK).map((m) => m.payload), skipDup);
      if (!r.ok) { toast.error(r.error); setProgress(null); return; }
      total.inserted += r.data.inserted; total.duplicates += r.data.duplicates; total.errors.push(...r.data.errors);
      setProgress(Math.min(1, (i + CHUNK) / valid.length));
    }
    total.errors.push(...invalid.map((m) => ({ row: m.row, message: m.errors.join(", ") })));
    setResult(total); setProgress(null);
    toast.success(`Imported ${total.inserted} bets`);
    router.refresh();
  };

  const template = () => downloadBlob(new Blob([toCsv(FIELDS.map((f) => f.key), [[
    "2026-03-01T15:00:00Z", "Team A v Team B", "Team A", "Team B", "football", "Asian Handicap", "Team A -0.25", "-0.25", "back", "1.95", "50", "EUR", "Pinnacle", "0", "half_won", "2026-03-01T17:00:00Z", "", "no", "55%", "2.02", "1.90", "Value", "epl|value", "",
  ]])], { type: "text/csv" }), "betting-edge-import-template.csv");

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent wide title="Import bets" description="CSV or Excel. Columns are mapped automatically; review the mapping and preview before importing. Profit is always recomputed from the result.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Label>File<input type="file" accept=".csv,.xlsx,.xls,text/csv" className="text-xs text-muted file:mr-2 file:rounded-[3px] file:border file:border-line-strong file:bg-panel-2 file:px-2 file:py-1 file:text-fg"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} /></Label>
            <Label>Into bankroll<Select value={bankroll} onChange={(e) => setBankroll(e.target.value)}>{app.bankrolls.filter((b) => !b.archived).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</Select></Label>
            <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} /> Skip duplicates (same time, event, market, selection, odds, stake, book)</label>
            <Button variant="ghost" size="sm" onClick={template} className="ml-auto">Download template</Button>
          </div>
          {fileName && <p className="text-xs text-muted">{fileName}: {rows.length} rows · <span className="text-up">{valid.length} valid</span> · <span className={invalid.length ? "text-down" : ""}>{invalid.length} with errors</span></p>}
          {headers.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
                {FIELDS.map((f) => (
                  <Label key={f.key}>{f.label}{f.required ? " *" : ""}
                    <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                      <option value="">— not mapped —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </Label>
                ))}
              </div>
              {missingRequired.length > 0 && <p className="text-xs text-warn">Map required fields: {missingRequired.map((f) => f.label).join(", ")}</p>}
              <div className="max-h-64 overflow-auto rounded-[3px] border border-line">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-panel-2"><tr>{["Row", "Date", "Event", "Selection", "Odds", "Stake", "Status", "Issues"].map((h) => <th key={h} className="label-xs px-2 py-1 text-left">{h}</th>)}</tr></thead>
                  <tbody>{mapped.slice(0, 50).map((m) => (
                    <tr key={m.row} className="border-t border-line/60">
                      <td className="num px-2 text-dim">{m.row}</td><td className="num px-2">{String(m.payload.placed_at ?? "").slice(0, 16)}</td>
                      <td className="px-2">{String(m.payload.event_name ?? "")}</td><td className="px-2">{String(m.payload.selection ?? "")}</td>
                      <td className="num px-2">{String(m.payload.odds ?? "")}</td><td className="num px-2">{String(m.payload.stake ?? "")}</td>
                      <td className="px-2">{String(m.payload.status ?? "")}</td><td className="px-2 text-down">{m.errors.join(", ")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {result && (
            <div className="rounded-[3px] border border-line p-2 text-xs">
              <b>{result.inserted}</b> imported · <b>{result.duplicates}</b> duplicates skipped · <b className={result.errors.length ? "text-down" : ""}>{result.errors.length}</b> errors
              {result.errors.length > 0 && <ul className="mt-1 max-h-32 overflow-auto text-down">{result.errors.slice(0, 100).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            {progress != null && <span className="num text-xs text-muted">Importing… {Math.round(progress * 100)}%</span>}
            <Button disabled={!valid.length || missingRequired.length > 0 || progress != null || !bankroll} onClick={run}>Import {valid.length} bets</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
