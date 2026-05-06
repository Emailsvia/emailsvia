import { supabaseAdmin } from "./supabase";

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

// Append a row to admin_audit for any operator-side mutation. Best-effort:
// audit insert failure does not abort the underlying action (the action
// already happened). All audit writes go through the service role.
export async function logAdminAction(
  actorId: string,
  action: string,
  target: { type: string; id: string } | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseAdmin().from("admin_audit").insert({
      actor_id: actorId,
      action,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      payload: payload ?? null,
    });
  } catch {
    // Swallow — telemetry, not a write barrier.
  }
}
