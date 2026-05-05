import { NextRequest, NextResponse } from "next/server";
import { parseXlsx } from "@/lib/xlsx";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  try {
    const buf = await file.arrayBuffer();
    const { rows, errors, columns } = parseXlsx(buf);
    return NextResponse.json({
      rows: rows.slice(0, 50),
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
