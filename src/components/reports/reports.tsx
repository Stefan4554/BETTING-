"use client";
import * as React from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Printer, Table2 } from "lucide-react";
import type { Report } from "@/lib/server/reports";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/app/primitives";
import { generateReport } from "@/app/actions/reports";
import { downloadBlob, toCsv } from "@/lib/export";
import { fmtDateTime } from "@/lib/format";

export function ReportsView({ types, defaultFrom, defaultTo, defaultBasis, sports, bookmakers, strategies }: {
  types: Record<string, string>; defaultFrom: string | null; defaultTo: string | null; defaultBasis: string; sports: string[]; bookmakers: string[]; strategies: string[];
}) {
  const [type, setType] = React.useState("monthly");
  const [from, setFrom] = React.useState(defaultFrom ?? "");
  const [to, setTo] = React.useState(defaultTo ?? "");
  const [filter, setFilter] = React.useState("");
  const [basis, setBasis] = React.useState(defaultBasis);
  const [report, setReport] = React.useState<Report | null>(null);
  const [busy, setBusy] = React.useState(false);
  const filters = type === "sport" ? sports : type === "bookmaker" ? bookmakers : type === "strategy" ? strategies : null;
  const run = async () => {
    setBusy(true);
    const r = await generateReport(type, from || null, to || null, filter || null, basis);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setReport(r.data);
  };
  React.useEffect(() => { void run(); /* initial report */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slug = report ? `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}` : "report";

  const pdf = async () => {
    if (!report) return;
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(15); doc.text(`Betting Edge Pro — ${report.title}`, 40, 40);
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`${report.period} · ${report.currency} · ${report.workspace === "demo" ? "DEMO WORKSPACE (simulated data)" : "live workspace"} · generated ${fmtDateTime(report.generatedAt)}`, 40, 56);
    doc.setTextColor(0);
    let y = 70;
    if (report.summary.length) {
      autoTable(doc, { startY: y, head: [["Metric", "Value"]], body: report.summary, theme: "grid", styles: { fontSize: 8 }, headStyles: { fillColor: [21, 52, 92] }, tableWidth: 360 });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    }
    for (const t of report.tables) {
      doc.setFontSize(11); doc.text(t.title, 40, y); y += 6;
      autoTable(doc, { startY: y, head: [t.columns], body: t.rows.map((r) => r.map((v) => (v == null ? "—" : String(v)))), theme: "striped", styles: { fontSize: 7 }, headStyles: { fillColor: [21, 52, 92] } });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
      if (y > 520) { doc.addPage(); y = 40; }
    }
    doc.setFontSize(8); doc.setTextColor(120); report.notes.forEach((n) => { doc.text(n, 40, y); y += 11; });
    doc.save(`${slug}.pdf`);
  };
  const xlsx = async () => {
    if (!report) return;
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet("Summary");
    sum.addRow([`Betting Edge Pro — ${report.title}`]).font = { bold: true, size: 13 };
    sum.addRow([report.period, report.currency, report.workspace === "demo" ? "DEMO (simulated)" : "live"]);
    sum.addRow([]);
    report.summary.forEach((r) => sum.addRow(r));
    report.notes.forEach((n) => sum.addRow([n]));
    report.tables.forEach((t, i) => {
      const ws = wb.addWorksheet(`${i + 1} ${t.title}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
      ws.addRow(t.columns).font = { bold: true };
      t.rows.forEach((r) => ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v))));
      ws.views = [{ state: "frozen", ySplit: 1 }];
    });
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slug}.xlsx`);
  };
  const csv = () => {
    if (!report) return;
    const parts = [toCsv(["Metric", "Value"], report.summary), ...report.tables.map((t) => `${t.title}\r\n${toCsv(t.columns, t.rows)}`)];
    downloadBlob(new Blob([parts.join("\r\n\r\n")], { type: "text/csv;charset=utf-8" }), `${slug}.csv`);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Reports" description="Generated from stored records on the server. Export as PDF, Excel or CSV, or print." />
      <Panel bodyClassName="flex flex-wrap items-end gap-2 p-3 no-print">
        <Label>Report<Select value={type} onChange={(e) => { setType(e.target.value); setFilter(""); }} className="w-48">{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Label>
        {filters && <Label>Filter<Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-44"><option value="">All</option>{filters.map((f) => <option key={f}>{f}</option>)}</Select></Label>}
        <Label>Date basis<Select value={basis} onChange={(e) => setBasis(e.target.value)} className="w-36"><option value="placed">Bet placed</option><option value="event">Event start</option><option value="settled">Settlement</option></Select></Label>
        <Label>From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Label>
        <Label>To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Label>
        <Button onClick={run} disabled={busy}>{busy ? "Generating…" : "Generate"}</Button>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" onClick={pdf} disabled={!report}><FileText className="h-3.5 w-3.5" /> PDF</Button>
          <Button variant="outline" onClick={xlsx} disabled={!report}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button>
          <Button variant="outline" onClick={csv} disabled={!report}><Table2 className="h-3.5 w-3.5" /> CSV</Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!report}><Printer className="h-3.5 w-3.5" /> Print</Button>
        </div>
      </Panel>
      {report && (
        <div className="flex flex-col gap-3 print:text-black">
          <div>
            <h2 className="text-lg font-semibold">{report.title} {report.workspace === "demo" && <Badge tone="demo">DEMO — simulated data</Badge>}</h2>
            <p className="text-xs text-muted">{report.period} · {report.currency} · generated {fmtDateTime(report.generatedAt)}</p>
          </div>
          {report.summary.length > 0 && (
            <Panel title="Summary" bodyClassName="grid grid-cols-1 gap-x-6 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.summary.map(([k, v]) => <div key={k} className="flex justify-between border-b border-line/60 py-1 text-xs"><span className="text-muted">{k}</span><span className="num">{v}</span></div>)}
            </Panel>
          )}
          {report.tables.map((t) => (
            <Panel key={t.title} title={t.title} subtitle={`${t.rows.length} rows`}>
              <div className="max-h-[520px] overflow-auto print:max-h-none">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-panel-2"><tr>{t.columns.map((c) => <th key={c} className="label-xs h-7 whitespace-nowrap px-2 text-left">{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, i) => <tr key={i} className="border-b border-line/60">{r.map((v, j) => <td key={j} className={`h-6 whitespace-nowrap px-2 ${typeof v === "number" ? "num" : ""}`}>{v == null ? "—" : typeof v === "number" ? v.toLocaleString("en-GB") : v}</td>)}</tr>)}
                    {!t.rows.length && <tr><td colSpan={t.columns.length} className="py-6 text-center text-dim">No data</td></tr>}</tbody>
                </table>
              </div>
            </Panel>
          ))}
          <ul className="list-disc pl-5 text-[11px] text-dim">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
