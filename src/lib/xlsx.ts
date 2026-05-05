import * as XLSX from "xlsx";

export type ParsedRow = {
  name: string;
  company: string;
  email: string;
  vars: Record<string, string>;
  row_index: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firstNonEmpty(vars: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    const hit = Object.keys(vars).find((kk) => kk.toLowerCase() === k.toLowerCase());
    if (hit && vars[hit]) return vars[hit];
  }
  return "";
}

export function parseXlsx(buf: ArrayBuffer): {
  rows: ParsedRow[];
  errors: string[];
  columns: string[];
} {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const columns: string[] = [];
  if (json[0]) {
    for (const k of Object.keys(json[0])) {
      const t = k.trim();
      if (t && !columns.includes(t)) columns.push(t);
    }
  }

  json.forEach((r, i) => {
    const vars: Record<string, string> = {};
    for (const k of Object.keys(r)) {
      const trimmed = k.trim();
      if (!trimmed) continue;
      const v = r[k];
      vars[trimmed] = v == null ? "" : String(v).trim();
    }
    const name = firstNonEmpty(vars, ["First Name", "Name", "FirstName"]);
    const company = firstNonEmpty(vars, ["Company Name", "Company"]);
    const email = firstNonEmpty(vars, ["Email", "Email Address", "E-mail"]).toLowerCase();

    if (!name || !company || !email) {
      errors.push(`row ${i + 2}: missing name/company/email`);
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push(`row ${i + 2}: invalid email "${email}"`);
      return;
    }
    if (seen.has(email)) {
      errors.push(`row ${i + 2}: duplicate "${email}" — skipped`);
      return;
    }
    seen.add(email);
    rows.push({ name, company, email, vars, row_index: i });
  });

  return { rows, errors, columns };
}
