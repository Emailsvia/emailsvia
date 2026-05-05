// Tiny helper to gate admin-only routes/pages on ADMIN_USER_IDS env. The
// env var is a comma-separated list of auth.users ids; missing or empty
// means "no admins" and locks /api/admin completely.
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS ?? "";
  if (!raw.trim()) return false;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}
