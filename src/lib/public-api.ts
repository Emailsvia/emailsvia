import "server-only";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "./supabase";
import { authenticateApiKey, extractApiKey } from "./api-key";
import { getPlanForUser, hasFeature, type Plan } from "./billing";

// Shared plumbing for /api/v1/*: API-key auth, the public_api plan gate,
// CORS, and uniform JSON errors.
//
// SECURITY: these routes use the service-role client (there's no user JWT,
// the caller authenticates with an API key), so RLS does NOT apply. Every
// query in a v1 handler must filter by `ctx.userId` explicitly.

export type ApiContext = {
  userId: string;
  plan: Plan;
  db: ReturnType<typeof supabaseAdmin>;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function apiOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function apiError(status: number, error: string, message?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(message ? { message } : {}), ...(extra ?? {}) }, { status });
}

type Handler<P> = (req: NextRequest, ctx: ApiContext, params: P) => Promise<NextResponse>;

export function withApi<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }): Promise<NextResponse> => {
    let res: NextResponse;
    try {
      const raw = extractApiKey(req.headers.get("authorization"));
      if (!raw) {
        res = apiError(401, "missing_api_key", "Send your key as: Authorization: Bearer eav_live_…");
      } else {
        const auth = await authenticateApiKey(raw);
        if (!auth) {
          res = apiError(401, "invalid_api_key");
        } else {
          const db = supabaseAdmin();
          const { plan } = await getPlanForUser(db, auth.user_id);
          if (!hasFeature(plan, "public_api")) {
            res = apiError(402, "public_api_not_enabled", `The API is available on the Scale plan. Your plan is ${plan.name}.`);
          } else {
            res = await handler(req, { userId: auth.user_id, plan, db }, (await route.params) ?? ({} as P));
          }
        }
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { route: "api_v1", path: req.nextUrl.pathname } });
      res = apiError(500, "internal_error");
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

export function intParam(req: NextRequest, name: string, def: number, min: number, max: number): number {
  const n = Number(req.nextUrl.searchParams.get(name));
  if (!Number.isFinite(n) || req.nextUrl.searchParams.get(name) === null) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
