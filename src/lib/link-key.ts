// Stable identity for a link, used for "clicked the pricing link" rules:
// host (without www) + path, lowercased, no query/fragment/trailing slash.
// Must match emailsvia_link_key() in migration 0025 (used by the backfill).
// Client-safe (the rule editor normalises what the user types with it).
export function linkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const k = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/(www\.)?/i, "")
    .replace(/^www\./i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase()
    .slice(0, 200);
  return k || null;
}
