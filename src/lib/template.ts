import { marked } from "marked";

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG = /\{\{\s*([^}]+?)\s*\}\}/g;

// `{{Key}}` or `{{Key | fallback}}`. The fallback is used when the column
// is missing or blank for a row. `{{ai: ...}}` tags are left whole (their
// prompt may legitimately contain "|").
function parseTag(raw: string): { key: string; fallback: string | null } {
  // The Markdown editor may save "|" as "\|"; treat both the same.
  const t = String(raw).trim().replace(/\\\|/g, "|");
  if (/^ai:/i.test(t)) return { key: t, fallback: null };
  const bar = t.indexOf("|");
  if (bar === -1) return { key: t, fallback: null };
  return { key: t.slice(0, bar).trim(), fallback: t.slice(bar + 1).trim() };
}

export function render(tpl: string, vars: Record<string, string>) {
  const resolved: Record<string, string> = {
    ...vars,
    Name: vars.Name ?? vars["First Name"] ?? vars.FirstName ?? "",
    Company: vars.Company ?? vars["Company Name"] ?? "",
  };
  return tpl.replace(TAG, (_m, raw) => {
    const { key: k, fallback } = parseTag(raw);
    const v = resolved[k];
    const has = Object.prototype.hasOwnProperty.call(resolved, k);
    if (fallback !== null) return has && v != null && String(v).trim() !== "" ? v : fallback;
    if (has) return v ?? "";
    return `{{${k}}}`;
  });
}

export function extractTags(tpl: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, "g");
  while ((m = re.exec(tpl))) out.add(parseTag(m[1]).key);
  return Array.from(out);
}

// Spintax: `{Hi|Hey|Hello}` picks one option. Deterministic per `seed` (use
// the recipient id + step) so retries, previews and the sent email agree,
// while different recipients get different wording. Double-brace merge
// tags are never touched. Nested spintax isn't supported.
const SPIN = /(?<!\{)\{([^{}]*\|[^{}]*)\}(?!\})/g;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function spin(tpl: string, seed: string): string {
  let n = 0;
  return tpl.replace(SPIN, (_m, body: string) => {
    const options = body.replace(/\\\|/g, "|").split("|");
    return options[hash32(`${seed}:${n++}`) % options.length];
  });
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
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG.source, "g");
  while ((m = re.exec(tpl))) {
    const { key, fallback } = parseTag(m[1]);
    if (fallback !== null) continue; // has a default, never "missing"
    const v = resolved[key];
    if (v === undefined || v === null || String(v).trim() === "") out.add(key);
  }
  return Array.from(out);
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
  const pixel = opts?.openPixelUrl
    ? `<img src="${escapeAttr(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;opacity:0;" />`
    : "";

  return (
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;' +
    'font-size:14px;line-height:1.55;color:#222;">' +
    html +
    footer +
    pixel +
    "</div>"
  );
}

export function toPlain(
  text: string,
  opts?: { unsubscribeUrl?: string }
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
  return out;
}
