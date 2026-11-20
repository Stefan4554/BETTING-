"use server";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { buildReport, REPORT_TYPES, type ReportType } from "@/lib/server/reports";
import { run } from "./util";

export async function generateReport(type: string, from: string | null, to: string | null, filter?: string | null) {
  return run(async () => {
    const t = z.enum(Object.keys(REPORT_TYPES) as [ReportType, ...ReportType[]]).parse(type);
    const d = z.string().date().nullable();
    return buildReport(await getContext(), t, d.parse(from || null), d.parse(to || null), filter ? z.string().max(120).parse(filter) : null);
  }, false);
}
