import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseSheet } from "@/lib/sheets";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  url: z.string().url(),
  sheet_name: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    const { rows, errors, columns } = await parseSheet(parsed.data.url, parsed.data.sheet_name);
    return NextResponse.json({
      rows: rows.slice(0, parsed.data.limit ?? 20),
      total: rows.length,
      columns,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
