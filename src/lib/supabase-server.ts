import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// User-scoped Supabase client. Reads the Supabase auth cookies set by
// middleware so every query runs as the signed-in user — RLS policies
// (user_id = auth.uid()) enforce row ownership server-side.
//
// Lives in its own file because next/headers makes the module
// server-component-only. Anything that runs in a client component must use
// the public-anon key directly, not this helper.
export async function supabaseUser() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        // In some server contexts (route handlers, server components) the
        // cookie store is effectively read-only. Middleware refreshes the
        // session cookie on every request, so swallowing the throw here is
        // safe (see @supabase/ssr docs).
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options as CookieOptions);
          }
        } catch {
          /* read-only cookie store — fine */
        }
      },
    },
  });
}
