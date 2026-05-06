import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// URL zones — gated by middleware before any page renders.
//
//   /admin/*        admin operator surface (only auth.users.id values
//                   listed in ADMIN_USER_IDS reach here). Admins NEVER
//                   land in /app — their account is operator-only by
//                   design. To grant a user normal product access,
//                   remove their id from ADMIN_USER_IDS.
//
//   /app/*          authenticated product surface (campaigns, senders…)
//                   Admins are bounced out of /app to /admin so the UI
//                   can't accidentally mix the two contexts.
//
//   AUTH_PAGES      auth surface (login / signup / forgot)
//                   Signed-in users (admin or not) get redirected to
//                   their respective home — /admin for admins, /app
//                   for everyone else.
//
//   "/" (landing)   marketing landing
//                   Signed-in users redirect to /admin or /app.
//
//   ALWAYS_PUBLIC   pricing / privacy / terms / auth callback /
//                   unsubscribe — visible to everyone regardless of
//                   auth state. Required for Google OAuth verification
//                   reviewers + signed-in users who may want to read.
//
// /api/* skips the middleware entirely; handlers enforce their own auth.

const ADMIN_PREFIX = "/admin";
const APP_PREFIX = "/app";
const AUTH_PAGES = ["/login", "/signup", "/forgot"];
const ALWAYS_PUBLIC = ["/pricing", "/privacy", "/terms", "/auth/callback"];

const PUBLIC_API_PREFIXES = [
  "/api/auth/",        // login/signup/logout/oauth-callback
  "/api/health",       // liveness probe (Vercel + uptime monitors)
  "/api/stripe/webhook", // Stripe POSTs without our cookies; signature-auth'd
  "/api/tick",         // cron, bearer-auth'd
  "/api/check-replies",// cron, bearer-auth'd
  "/api/cron/",        // /api/cron/* — bearer-auth'd cron paths
  "/api/t/",           // open + click pixels (HMAC-signed URLs)
  "/api/unsubscribe",  // user-clicks-from-email (HMAC-signed)
];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function inZone(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function isAuthSurface(pathname: string) {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAlwaysPublic(pathname: string) {
  if (pathname.startsWith("/u/")) return true; // unsubscribe landing
  return ALWAYS_PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// In-process check (no DB hit). ADMIN_USER_IDS is comma-separated UUIDs.
function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS ?? "";
  if (!raw.trim()) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

function homeFor(isAdmin: boolean): string {
  return isAdmin ? "/admin" : "/app";
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // API routes — handlers do their own auth.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Supabase OAuth completion safety net: if a Supabase project is misconfigured
  // and drops the ?code= on the root path instead of /auth/callback, forward it
  // to the proper handler so the session gets exchanged. The fix should still
  // happen in Supabase Dashboard → Authentication → URL Configuration → add
  // `${APP_URL}/auth/callback` to the Redirect URLs allowlist.
  if (pathname === "/" && searchParams.has("code")) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/auth/callback";
    return NextResponse.redirect(redirect);
  }

  // Always-public pages — no session needed.
  if (isAlwaysPublic(pathname)) return NextResponse.next();

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Misconfig: don't lock the user out, just let through. The page will
    // throw its own clearer error.
    return NextResponse.next();
  }

  // Build a Supabase client that reads request cookies and writes any
  // refreshed-session cookies onto the response. Documented @supabase/ssr
  // middleware pattern.
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          req.cookies.set(name, value);
        }
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdminUserId(user?.id);

  // Signed-in: redirect away from landing / auth pages to the right home.
  if (user && (pathname === "/" || isAuthSurface(pathname))) {
    const dest = req.nextUrl.clone();
    dest.pathname = homeFor(admin);
    return NextResponse.redirect(dest);
  }

  // /admin/* — admins only. Signed-out → /login. Non-admin signed-in →
  // bounced to /app (their proper home). Mixing roles in one UI is an
  // explicit non-goal.
  if (inZone(pathname, ADMIN_PREFIX)) {
    if (!user) {
      const redirect = req.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("next", pathname);
      return NextResponse.redirect(redirect);
    }
    if (!admin) {
      const dest = req.nextUrl.clone();
      dest.pathname = "/app";
      return NextResponse.redirect(dest);
    }
    return response;
  }

  // /app/* — regular users only. Signed-out → /login. Admin signed-in →
  // bounced to /admin so the operator account can't accidentally use
  // product features (and so the operator UI never has to render
  // user-context pages).
  if (inZone(pathname, APP_PREFIX)) {
    if (!user) {
      const redirect = req.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("next", pathname);
      return NextResponse.redirect(redirect);
    }
    if (admin) {
      const dest = req.nextUrl.clone();
      dest.pathname = "/admin";
      return NextResponse.redirect(dest);
    }
    return response;
  }

  // Otherwise: let through with the (possibly refreshed) cookies attached.
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
