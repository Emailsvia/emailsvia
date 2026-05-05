import { marked } from "marked";

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG = /\{\{\s*([^}]+?)\s*\}\}/g;

export function render(tpl: string, vars: Record<string, string>) {
  const resolved: Record<string, string> = {
    ...vars,
    Name: vars.Name ?? vars["First Name"] ?? vars.FirstName ?? "",
    Company: vars.Company ?? vars["Company Name"] ?? "",
  };
  return tpl.replace(TAG, (_m, key) => {
    const k = String(key).trim();
    const v = resolved[k];
    if (Object.prototype.hasOwnProperty.call(resolved, k)) return v ?? "";
    return `{{${k}}}`;
  });
}

export function extractTags(tpl: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, "g");
  while ((m = re.exec(tpl))) out.add(m[1].trim());
  return Array.from(out);
}

// Returns the set of tag names referenced by `tpl` that resolve to empty
// for `vars`. Drives strict-merge behaviour in the tick handler and the
// pre-flight UI on the campaign page. Honours the same Name/Company
// fall-back keys that render() does so a row with First Name still
// counts as having Name.
export function missingMergeFields(tpl: string, vars: Record<string, string>): string[] {
  const resolved: Record<string, string> = {
    ...vars,
    Name: vars.Name ?? vars["First Name"] ?? vars.FirstName ?? "",
    Company: vars.Company ?? vars["Company Name"] ?? "",
  };
  const tags = extractTags(tpl);
  const out: string[] = [];
  for (const t of tags) {
    const v = resolved[t];
    if (v === undefined || v === null || String(v).trim() === "") out.push(t);
  }
  return out;
}

function escapeAttr(v: string) {
  return String(v).replace(/"/g, "&quot;");
}

export function toHtml(
  text: string,
  opts?: {
    wrapUrl?: (url: string) => string;
    openPixelUrl?: string;
    unsubscribeUrl?: string;
    // Free-tier "Sent with EmailsVia" footer. Removed automatically the
    // moment a user upgrades to any paid tier.
    watermark?: boolean;
  }
) {
  // Full markdown parsing — bold, italic, strike, headings, lists, links, quotes, code.
  let html = marked.parse(text, { gfm: true, breaks: true, async: false }) as string;

  // Inject blue-underline + optional click-tracking wrap on every <a>
  html = html.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*)>/g, (_m, pre, href, post) => {
    const finalHref = opts?.wrapUrl ? opts.wrapUrl(href) : href;
    return `<a ${pre}href="${escapeAttr(finalHref)}"${post} style="color:#2563eb;text-decoration:underline;">`;
  });

  const footer = opts?.unsubscribeUrl
    ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;color:#888;font-size:11px;">If you'd rather not hear from me, <a href="${escapeAttr(opts.unsubscribeUrl)}" style="color:#888;">unsubscribe</a>.</div>`
    : "";
  const watermark = opts?.watermark
    ? `<div style="margin-top:18px;color:#999;font-size:11px;">Sent with <a href="https://emailsvia.com" style="color:#999;">EmailsVia</a> &mdash; <a href="https://emailsvia.com" style="color:#999;">try free</a></div>`
    : "";
  const pixel = opts?.openPixelUrl
    ? `<img src="${escapeAttr(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;opacity:0;" />`
    : "";

  return (
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;' +
    'font-size:14px;line-height:1.55;color:#222;">' +
    html +
    footer +
    watermark +
    pixel +
    "</div>"
  );
}

export function toPlain(
  text: string,
  opts?: { unsubscribeUrl?: string; watermark?: boolean }
) {
  // Strip markdown markers for the plain-text part
  let out = text
    .replace(MD_LINK, (_m, label, url) => `${label} (${url})`)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "");
  if (opts?.unsubscribeUrl) out += `\n\n---\nUnsubscribe: ${opts.unsubscribeUrl}`;
  if (opts?.watermark) out += "\n\nSent with EmailsVia — https://emailsvia.com";
  return out;
}
