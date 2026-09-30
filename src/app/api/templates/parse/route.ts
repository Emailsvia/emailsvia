import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { importTemplate, TemplateImportError, TEMPLATE_MAX_BYTES } from "@/lib/template-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Upload a template file (.docx, .html, .md, .txt) → { subject, body }.
// Nothing is stored: the editor fills in and the user saves as usual.
export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a file." }, { status: 400 });
  if (file.size > TEMPLATE_MAX_BYTES) return NextResponse.json({ error: "That file is over 2 MB." }, { status: 413 });
  try {
    const out = await importTemplate(file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ...out, filename: file.name });
  } catch (e) {
    if (e instanceof TemplateImportError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Couldn't read that file." }, { status: 400 });
  }
}
