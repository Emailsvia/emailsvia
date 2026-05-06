import { supabaseUser } from "./supabase-server";

export type AuthedUser = { id: string; email: string | null };

// Returns the signed-in user or null. Cheap; safe to call from anywhere
// inside a server component or route handler.
export async function getUser(): Promise<AuthedUser | null> {
  const sb = await supabaseUser();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

// Throws a 401 Response when the request is unauthenticated. Use in API
// routes that already throw to short-circuit on auth failure.
export async function requireUser(): Promise<AuthedUser> {
  const u = await getUser();
  if (!u) throw new Response("unauthorized", { status: 401 });
  return u;
}
