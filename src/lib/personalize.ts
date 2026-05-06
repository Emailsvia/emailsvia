import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiProvider } from "./ai-provider";

// AI personalization at template-render time. Users embed
// `{{ai:Write a one-sentence opener referencing their role}}` in their
// campaign body; we call the configured AI provider per recipient to
// expand it.
//
// Cached per (recipient_id, tag-text, prompt_hash) in ai_personalizations
// so a re-render or retry never re-pays. Hard daily-cost cap per user
// (configurable via env, defaults to 1000 calls/day) so a runaway
// template can't blow up the bill.
//
// Best-effort: when no provider is configured, the AI feature is plan-
// gated off, or the daily cap is reached, the {{ai:...}} tag is replaced
// with the empty string so the rest of the email still sends. The
// campaign owner sees the issue surfaced via recipients.error / send_log.

const AI_TAG = /\{\{\s*ai:([^}]+?)\s*\}\}/g;

const DAILY_CAP = Number(process.env.AI_PERSONALIZATION_DAILY_CAP ?? "1000");

const SYSTEM_PROMPT = `You generate a single short personalized text snippet for a cold-email campaign. The user describes WHAT they want; you produce only the snippet itself — no preamble, no explanation, no quotes, no markdown. One to three sentences max. Match the tone of natural professional email. If the recipient context is too sparse to do a good job, output a short, generic, harmless line (e.g. "Hope your week's going well") rather than making things up.`;

export type PersonalizeContext = {
  db: SupabaseClient;
  recipient_id: string;
  user_id: string;
  // Caller-provided plan flag. If false, every {{ai:...}} resolves to
  // empty string without an API call. Lets the gate live with the
  // existing plan logic in tick rather than re-querying here.
  enabled: boolean;
};

export type PersonalizeResult = {
  rendered: string;
  ai_calls: number;        // total Haiku calls actually made
  cache_hits: number;
  skipped: number;         // tags that hit the daily cap or feature gate
};

// Scan `template` for {{ai:...}} tags. For each unique tag text, look up
// or generate the personalized snippet, then substitute. Other merge tags
// ({{Name}}, {{Company}}) are NOT touched — caller still runs render()
// after this.
export async function personalizeTemplate(
  template: string,
  vars: Record<string, string>,
  ctx: PersonalizeContext
): Promise<PersonalizeResult> {
  const matches = Array.from(template.matchAll(AI_TAG));
  if (matches.length === 0) {
    return { rendered: template, ai_calls: 0, cache_hits: 0, skipped: 0 };
  }

  // De-duplicate identical directives so two {{ai:...}} of the same body
  // text only round-trip Haiku once per recipient.
  const uniqueDirectives = Array.from(new Set(matches.map((m) => m[1].trim())));

  let aiCalls = 0;
  let cacheHits = 0;
  let skipped = 0;
  const resolved = new Map<string, string>();

  for (const directive of uniqueDirectives) {
    if (!ctx.enabled) {
      resolved.set(directive, "");
      skipped++;
      continue;
    }
    const promptHash = hashPrompt(directive, vars);
    const cached = await readCache(ctx, directive, promptHash);
    if (cached !== null) {
      resolved.set(directive, cached);
      cacheHits++;
      continue;
    }
    const usedToday = await todaysUsage(ctx);
    if (usedToday >= DAILY_CAP) {
      resolved.set(directive, "");
      skipped++;
      continue;
    }
    const generated = await generate(directive, vars);
    if (generated === null) {
      resolved.set(directive, "");
      skipped++;
      continue;
    }
    resolved.set(directive, generated.text);
    await writeCache(ctx, directive, promptHash, generated.text, generated.tokens);
    aiCalls++;
  }

  const rendered = template.replace(AI_TAG, (_match, raw: string) => {
    return resolved.get(String(raw).trim()) ?? "";
  });

  return { rendered, ai_calls: aiCalls, cache_hits: cacheHits, skipped };
}

function hashPrompt(directive: string, vars: Record<string, string>): string {
  // Stable JSON: sort keys so {Name:"A", Company:"B"} and {Company:"B", Name:"A"}
  // hash the same.
  const sortedVars = Object.keys(vars)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = vars[k];
      return acc;
    }, {});
  return crypto
    .createHash("sha256")
    .update(directive + "|" + JSON.stringify(sortedVars))
    .digest("hex");
}

async function readCache(
  ctx: PersonalizeContext,
  directive: string,
  promptHash: string
): Promise<string | null> {
  const { data } = await ctx.db
    .from("ai_personalizations")
    .select("output")
    .eq("recipient_id", ctx.recipient_id)
    .eq("tag", directive)
    .eq("prompt_hash", promptHash)
    .maybeSingle();
  return data?.output ?? null;
}

async function writeCache(
  ctx: PersonalizeContext,
  directive: string,
  promptHash: string,
  output: string,
  tokens: number
): Promise<void> {
  await ctx.db
    .from("ai_personalizations")
    .insert({
      user_id: ctx.user_id,
      recipient_id: ctx.recipient_id,
      tag: directive,
      prompt_hash: promptHash,
      output,
      cost_tokens: tokens,
    });
}

async function todaysUsage(ctx: PersonalizeContext): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await ctx.db
    .from("ai_personalizations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", ctx.user_id)
    .gte("created_at", since);
  return count ?? 0;
}

async function generate(
  directive: string,
  vars: Record<string, string>
): Promise<{ text: string; tokens: number } | null> {
  const provider = getAiProvider();
  if (!provider) return null;

  // Build a compact context block. We prepend well-known fields so the
  // model sees structured info even when the campaign owner used arbitrary
  // column names.
  const knownLines: string[] = [];
  if (vars.Name || vars["First Name"] || vars.FirstName) {
    knownLines.push(`Name: ${vars.Name ?? vars["First Name"] ?? vars.FirstName}`);
  }
  if (vars.Company || vars["Company Name"]) {
    knownLines.push(`Company: ${vars.Company ?? vars["Company Name"]}`);
  }
  // Drop already-emitted fields from the vars dump.
  const omitted = new Set(["Name", "First Name", "FirstName", "Company", "Company Name"]);
  const otherLines = Object.entries(vars)
    .filter(([k, v]) => !omitted.has(k) && v && String(v).trim().length > 0)
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 240)}`);

  const userMsg = [
    "Recipient context:",
    ...knownLines,
    ...otherLines,
    "",
    `Goal: ${directive}`,
  ].join("\n");

  return provider.complete({
    system: SYSTEM_PROMPT,
    user: userMsg,
    maxTokens: 200,
  });
}

// Convenience helper for the campaign editor / preview pane: tells the
// caller whether a given template uses any AI tags so the UI can show a
// hint about plan-gating + daily caps.
export function templateUsesAi(template: string): boolean {
  AI_TAG.lastIndex = 0;
  return AI_TAG.test(template);
}
