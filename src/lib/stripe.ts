import "server-only";
import Stripe from "stripe";
import type { PlanId } from "./billing";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  // Don't pin apiVersion — TypeScript types tie it to the installed SDK
  // major and a stale string here triggers compile errors after upgrades.
  // Stripe's default (= the version on the installed key) is fine.
  cached = new Stripe(key);
  return cached;
}

// Map paid plan ids -> Stripe price ids. Free has no Stripe price.
export function stripePriceFor(planId: PlanId): string | null {
  switch (planId) {
    case "starter":
      return process.env.STRIPE_PRICE_STARTER ?? null;
    case "growth":
      return process.env.STRIPE_PRICE_GROWTH ?? null;
    case "scale":
      return process.env.STRIPE_PRICE_SCALE ?? null;
    case "free":
    default:
      return null;
  }
}

// Reverse map: given a price id (from a webhook), figure out which tier it
// corresponds to. Returns null for unknown / one-off prices.
export function planIdForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return "growth";
  if (priceId === process.env.STRIPE_PRICE_SCALE) return "scale";
  return null;
}
