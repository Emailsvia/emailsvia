import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listSheets } from "@/lib/sheets";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ url: z.string().url() });

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  try {
    const { fileId, sheets } = await listSheets(parsed.data.url);
    return NextResponse.json({ fileId, sheets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
