import * as XLSX from "xlsx";
import { parseXlsx, type ParsedRow } from "@/lib/xlsx";

export function extractFileId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

export function extractGid(url: string): string | null {
  const m = url.match(/[?&#]gid=(\d+)/);
  return m ? m[1] : null;
}

async function fetchSpreadsheetBuffer(fileId: string): Promise<ArrayBuffer> {
  // Works for sheets shared as "Anyone with the link" without auth.
  const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
  const res = await fetch(exportUrl, { cache: "no-store", redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Google Sheets fetch failed (${res.status}). Make sure the sheet is shared as "Anyone with the link can view".`
    );
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("spreadsheet") && !ct.includes("octet-stream") && !ct.includes("excel")) {
    throw new Error(
      'Got an HTML response from Google Sheets — the sheet is probably private. Set sharing to "Anyone with the link can view".'
    );
  }
  return await res.arrayBuffer();
}

export async function listSheets(url: string): Promise<{ fileId: string; sheets: string[] }> {
  const fileId = extractFileId(url);
  if (!fileId) throw new Error("Couldn't find a spreadsheet ID in that URL.");
  const buf = await fetchSpreadsheetBuffer(fileId);
  const wb = XLSX.read(buf, { type: "array" });
  return { fileId, sheets: wb.SheetNames };
}

export async function parseSheet(
  url: string,
  sheetName: string
): Promise<{ rows: ParsedRow[]; errors: string[]; columns: string[] }> {
  const fileId = extractFileId(url);
  if (!fileId) throw new Error("Couldn't find a spreadsheet ID in that URL.");
  const buf = await fetchSpreadsheetBuffer(fileId);
  // parseXlsx only reads the first sheet, so we slice it to the chosen one.
  const wb = XLSX.read(buf, { type: "array" });
  if (!wb.SheetNames.includes(sheetName)) throw new Error(`Sheet "${sheetName}" not found.`);
  // build a single-sheet workbook as an ArrayBuffer and reuse parseXlsx
  const single = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(single, wb.Sheets[sheetName], sheetName);
  const out = XLSX.write(single, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return parseXlsx(out);
}
