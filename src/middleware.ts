import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// The app is split into three URL zones:
//
//   /app/*          authenticated product surface (campaigns, senders, etc)
//   /login, /signup,
//   /forgot, /auth/callback   auth surface
//   everything else marketing surface (landing, pricing, privacy, terms,
//                  /u/[token], /api/*)
//
// Only /app/* is gated. Marketing and auth pages stay public so visitors
// (and Google's OAuth verification reviewers) can read privacy/terms and
// the landing page without a login redirect.
const AUTHED_PREFIX = "/app";
const PUBLIC_API_PREFIXES = [
  "/api/auth/",        // login/signup/logout/oauth-callback
  "/api/stripe/webhook", // Stripe POSTs without our cookies; signature-auth'd
  "/api/tick",         // cron, bearer-auth'd
  "/api/check-replies",// cron, bearer-auth'd
  "/api/t/",           // open + click pixels (HMAC-signed URLs)
  "/api/unsubscribe",  // user-clicks-from-email (HMAC-signed)
];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isAuthedPage(pathname: string) {
  return pathname === AUTHED_PREFIX || pathname.startsWith(AUTHED_PREFIX + "/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API routes either auth themselves inside the handler or are explicitly
  // public (cron, tracking, webhook). Either way we don't gate them here.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    return NextResponse.next();
  }

  // Anything outside /app/* is marketing or auth surface — public.
  if (!isAuthedPage(pathname)) return NextResponse.next();

  // /app/* — must be signed in. Refresh the Supabase session cookies on the
  // response so subsequent requests see a valid token (this is the
  // documented @supabase/ssr middleware pattern).
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Misconfig: don't lock the user out, just let through. The page will
    // throw its own clearer error.
    return NextResponse.next();
  }

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

  if (!user) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
