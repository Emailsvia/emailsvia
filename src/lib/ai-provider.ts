import "server-only";
import type { ZodSchema } from "zod";

// Pluggable AI backend. Reply triage and {{ai:...}} personalization both
// go through here so the same provider preference covers both. Auto-detects
// which provider to use from env keys; or set AI_PROVIDER=groq|gemini|anthropic
// to pin one.
//
// Pricing (per 1M tokens, input/output, late 2025):
//   Groq llama-3.3-70b-versatile : ~$0.59 / $0.79  (also free tier)
//   Groq llama-3.1-8b-instant   : ~$0.05 / $0.08  (cheapest, classification only)
//   Gemini 1.5/2.5 Flash         : ~$0.075 / $0.30
//   Anthropic Haiku 4.5         : ~$1.00 / $5.00  (most expensive, best quality)
//
// All three are good enough for cold-email reply triage and short
// personalized snippets at our volume — Groq + Gemini are dramatically
// cheaper, so we default to "whichever cheap key you've set".

export type ProviderName = "anthropic" | "gemini" | "groq";

export type ClassifyArgs<T> = {
  system: string;
  user: string;
  schema: ZodSchema<T>;
  maxTokens?: number;
};

export type CompleteArgs = {
  system: string;
  user: string;
  maxTokens?: number;
};

export type CompleteResult = { text: string; tokens: number };

export type AiProvider = {
  name: ProviderName;
  // Human-readable label for /admin/system + logs.
  label: string;
  // Models in use (so the operator UI can show them too).
  triageModel: string;
  generateModel: string;
  // Returns null on any failure so callers can stay best-effort.
  classify<T>(args: ClassifyArgs<T>): Promise<T | null>;
  complete(args: CompleteArgs): Promise<CompleteResult | null>;
};

// Resolution order:
//   1. Explicit AI_PROVIDER env (if set AND that provider has a key)
//   2. First key found in priority order: Groq > Gemini > Anthropic
//   3. null when no provider is configured (caller falls back to non-AI behavior)
export function getAiProvider(): AiProvider | null {
  const explicit = (process.env.AI_PROVIDER ?? "").trim().toLowerCase() as ProviderName | "";
  const keys = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };

  if (explicit && keys[explicit as ProviderName]) {
    return providerFor(explicit as ProviderName);
  }
  if (keys.groq) return providerFor("groq");
  if (keys.gemini) return providerFor("gemini");
  if (keys.anthropic) return providerFor("anthropic");
  return null;
}

// Lightweight describe-only helper for admin UI. Returns the provider that
// WOULD be used + which keys are present, without doing any I/O.
export function describeAiProviders(): {
  active: ProviderName | null;
  available: ProviderName[];
  triage_model: string | null;
  generate_model: string | null;
} {
  const p = getAiProvider();
  const available: ProviderName[] = [];
  if (process.env.GROQ_API_KEY) available.push("groq");
  if (process.env.GEMINI_API_KEY) available.push("gemini");
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  return {
    active: p?.name ?? null,
    available,
    triage_model: p?.triageModel ?? null,
    generate_model: p?.generateModel ?? null,
  };
}

function providerFor(name: ProviderName): AiProvider {
  if (name === "groq") return groqProvider();
  if (name === "gemini") return geminiProvider();
  return anthropicProvider();
}

// ============================================================
// Groq — OpenAI-compatible REST. Cheapest tier for triage.
// ============================================================
function groqProvider(): AiProvider {
  const apiKey = process.env.GROQ_API_KEY ?? "";
  // Allow per-task overrides so an ops-savvy user can drop to 8b for cost.
  const triageModel = process.env.GROQ_TRIAGE_MODEL ?? "llama-3.1-8b-instant";
  const generateModel = process.env.GROQ_GENERATE_MODEL ?? "llama-3.3-70b-versatile";

  return {
    name: "groq",
    label: "Groq",
    triageModel,
    generateModel,
    async classify<T>({ system, user, schema, maxTokens }: ClassifyArgs<T>) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: triageModel,
            // json_object mode forces the model to emit valid JSON. We add
            // an explicit "respond as JSON" nudge in the system prompt to
            // satisfy Groq's policy requirement for json mode.
            response_format: { type: "json_object" },
            max_tokens: maxTokens ?? 200,
            temperature: 0.1,
            messages: [
              { role: "system", content: `${system}\n\nRespond with a single JSON object only.` },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== "string") return null;
        const parsed = schema.safeParse(JSON.parse(content));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async complete({ system, user, maxTokens }: CompleteArgs) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: generateModel,
            max_tokens: maxTokens ?? 300,
            temperature: 0.7,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) return null;
        const tokens =
          (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);
        return { text: text.trim(), tokens };
      } catch {
        return null;
      }
    },
  };
}

// ============================================================
// Gemini — Google's REST API. Cheap and fast.
// ============================================================
function geminiProvider(): AiProvider {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const triageModel = process.env.GEMINI_TRIAGE_MODEL ?? "gemini-1.5-flash";
  const generateModel = process.env.GEMINI_GENERATE_MODEL ?? "gemini-1.5-flash";

  async function callGemini(
    model: string,
    system: string,
    user: string,
    maxTokens: number,
    jsonOut: boolean,
  ): Promise<{ text: string; tokens: number } | null> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: jsonOut ? 0.1 : 0.7,
          ...(jsonOut ? { responseMimeType: "application/json" } : {}),
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string" || !text.trim()) return null;
      const tokens =
        (json.usageMetadata?.promptTokenCount ?? 0) +
        (json.usageMetadata?.candidatesTokenCount ?? 0);
      return { text: text.trim(), tokens };
    } catch {
      return null;
    }
  }

  return {
    name: "gemini",
    label: "Gemini",
    triageModel,
    generateModel,
    async classify<T>({ system, user, schema, maxTokens }: ClassifyArgs<T>) {
      const out = await callGemini(
        triageModel,
        `${system}\n\nRespond with a single JSON object only.`,
        user,
        maxTokens ?? 200,
        true,
      );
      if (!out) return null;
      try {
        const parsed = schema.safeParse(JSON.parse(out.text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async complete({ system, user, maxTokens }: CompleteArgs) {
      return callGemini(generateModel, system, user, maxTokens ?? 300, false);
    },
  };
}

// ============================================================
// Anthropic — Claude Haiku. Highest quality, highest price.
// ============================================================
function anthropicProvider(): AiProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const triageModel = process.env.ANTHROPIC_TRIAGE_MODEL ?? "claude-haiku-4-5";
  const generateModel = process.env.ANTHROPIC_GENERATE_MODEL ?? "claude-haiku-4-5";

  async function callAnthropic(
    model: string,
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ text: string; tokens: number } | null> {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const block = json.content?.find((b: { type?: string }) => b.type === "text");
      const text = block?.text;
      if (typeof text !== "string" || !text.trim()) return null;
      const tokens =
        (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
      return { text: text.trim(), tokens };
    } catch {
      return null;
    }
  }

  return {
    name: "anthropic",
    label: "Anthropic Claude",
    triageModel,
    generateModel,
    async classify<T>({ system, user, schema, maxTokens }: ClassifyArgs<T>) {
      // Ask for plain JSON. Haiku follows the format reliably when told to.
      const out = await callAnthropic(
        triageModel,
        `${system}\n\nRespond with a single JSON object only — no preamble, no markdown.`,
        user,
        maxTokens ?? 200,
      );
      if (!out) return null;
      try {
        // Strip ```json fences just in case.
        const cleaned = out.text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
        const parsed = schema.safeParse(JSON.parse(cleaned));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async complete({ system, user, maxTokens }: CompleteArgs) {
      return callAnthropic(generateModel, system, user, maxTokens ?? 300);
    },
  };
}
