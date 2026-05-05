import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// The app is split into three URL zones:
//
//   /app/*          authenticated product surface (campaigns, senders, etc)
//                   - signed-out visitors → bounced to /login
//                   - signed-in visitors  → let through
//
//   AUTH_PAGES      auth surface (login / signup / forgot)
//                   - signed-in visitors  → bounced to /app (avoid the
//                                           "I'm logged in but the login
//                                           page still loads" footgun)
//                   - signed-out visitors → let through
//
//   "/" (landing)   marketing landing
//                   - signed-in visitors  → bounced to /app
//                   - signed-out visitors → let through
//
//   PUBLIC_PAGES    pricing / privacy / terms / auth callback / unsubscribe
//                   landing pages — visible to EVERYONE regardless of auth
//                   state. Legal + marketing pages must stay reachable for
//                   logged-in users (they may want to read them) and for
//                   Google's OAuth verification reviewers.
//
// API routes (/api/*) skip the middleware entirely — handlers do their
// own auth.
const AUTHED_PREFIX = "/app";
const AUTH_PAGES = ["/login", "/signup", "/forgot"];
// Pages that are always public — no auth-state-driven redirect.
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

function isAuthedPage(pathname: string) {
  return pathname === AUTHED_PREFIX || pathname.startsWith(AUTHED_PREFIX + "/");
}

function isAuthSurface(pathname: string) {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isAlwaysPublic(pathname: string) {
  if (pathname.startsWith("/u/")) return true; // unsubscribe landing
  return ALWAYS_PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API routes either auth themselves inside the handler or are explicitly
  // public (cron, tracking, webhook). Either way we don't gate them here.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Always-public pages (pricing, privacy, terms, /u/*, /auth/callback)
  // skip the session check entirely — they render the same for everyone.
  if (isAlwaysPublic(pathname)) return NextResponse.next();

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Misconfig: don't lock the user out, just let through. The page will
    // throw its own clearer error.
    return NextResponse.next();
  }

  // Build a Supabase client that reads the request cookies and writes any
  // refreshed-session cookies onto the response we'll eventually return.
  // This is the documented @supabase/ssr middleware pattern.
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

  // Signed-in user hits the landing page → take them to the app instead
  // of the marketing pitch they've already bought into.
  if (user && pathname === "/") {
    const dest = req.nextUrl.clone();
    dest.pathname = "/app";
    return NextResponse.redirect(dest);
  }

  // Signed-in user hits an auth page → same idea. Avoids the
  // "I'm logged in but /login still loads, why?" confusion.
  if (user && isAuthSurface(pathname)) {
    const dest = req.nextUrl.clone();
    dest.pathname = "/app";
    return NextResponse.redirect(dest);
  }

  // Signed-out user hits a /app/* page → bounce to /login with `next` so
  // we land them on the page they wanted after signin.
  if (!user && isAuthedPage(pathname)) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // Otherwise: let through with the (possibly refreshed) cookies attached.
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
