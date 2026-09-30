import "server-only";
import mammoth from "mammoth";

// Turn an uploaded template file into an email body the editor understands
// (Markdown, or HTML it converts on the next edit). A first line
// "Subject: …" is lifted out as the subject.
//   .docx → HTML via mammoth (images dropped: they'd be inlined as huge
//           data URIs and cold emails shouldn't carry them anyway)
//   .html → the <body>, minus scripts/styles/comments
//   .md / .txt → as is

export const TEMPLATE_MAX_BYTES = 2_000_000;

export class TemplateImportError extends Error {}

export async function importTemplate(filename: string, buf: Buffer): Promise<{ subject: string | null; body: string }> {
  const name = filename.toLowerCase();
  let body: string;
  if (name.endsWith(".docx")) {
    const out = await mammoth.convertToHtml(
      { buffer: buf },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
    );
    body = out.value.replace(/<img[^>]*>/gi, "");
  } else if (/\.(html?|htm)$/.test(name)) {
    const text = buf.toString("utf8");
    const m = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    body = (m ? m[1] : text)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");
  } else if (/\.(txt|md|markdown)$/.test(name)) {
    body = buf.toString("utf8");
  } else if (name.endsWith(".doc")) {
    throw new TemplateImportError("Old .doc files aren't supported. Save it as .docx and upload again.");
  } else {
    throw new TemplateImportError("Upload a .docx, .html, .md or .txt file.");
  }
  body = body.replace(/\r\n/g, "\n").trim();

  // "Subject: …" on the first line (plain text, or the first HTML paragraph).
  let subject: string | null = null;
  const plain = body.match(/^(?:<p>)?\s*subject\s*:\s*([^\n<]{1,300})(?:<\/p>)?\s*/i);
  if (plain) {
    subject = plain[1].trim();
    body = body.slice(plain[0].length).trim();
  }
  if (!body) throw new TemplateImportError("That file has no text in it.");
  if (body.length > 100_000) throw new TemplateImportError("That template is too long (over 100,000 characters).");
  return { subject, body };
}
