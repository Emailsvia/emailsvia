// Lightweight spam pre-flight check. Returns warnings + 0-100 score.
// Used in the compose UI to flag red flags before sending.

const TRIGGER_WORDS = [
  "free", "winner", "guaranteed", "cash", "prize",
  "click here", "buy now", "limited time", "act now",
  "urgent", "congratulations", "selected", "no obligation",
  "risk-free", "100% free", "best price", "save up to",
];

const SUBJECT_SPAMMY_RE = /(\$|!{2,}|\?{2,}|100%|free|\bWIN\b)/i;

export type SpamReport = { score: number; warnings: string[] };

export function spamCheck(subject: string, body: string): SpamReport {
  const warnings: string[] = [];
  let score = 0;
  const combined = `${subject}\n${body}`.toLowerCase();

  for (const w of TRIGGER_WORDS) {
    if (combined.includes(w)) {
      warnings.push(`Contains "${w}"`);
      score += 8;
    }
  }

  const letters = subject.replace(/[^A-Za-z]/g, "");
  if (letters.length > 4) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    const ratio = caps / letters.length;
    if (ratio > 0.6) {
      warnings.push("Subject is mostly UPPERCASE");
      score += 20;
    }
  }

  const exclaim = (subject.match(/!/g) || []).length;
  if (exclaim >= 3) { warnings.push(`${exclaim} exclamation marks in subject`); score += 15; }

  if (SUBJECT_SPAMMY_RE.test(subject)) {
    warnings.push("Subject contains spammy punctuation or words");
    score += 10;
  }

  // Cold email: links are the #1 filter trigger on a first touch, and replies
  // drop sharply past ~100 words (Gong: 50–100 words; Instantly: <80).
  const links =
    (body.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length +
    (body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "").match(/https?:\/\/\S+/g) || []).length;
  if (links > 2) { warnings.push(`${links} links. Cold emails with more than 1–2 links get filtered more often`); score += 12; }
  const words = body
    .replace(/\{\{[^}]*\}\}/g, "x")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .split(/\s+/)
    .filter(Boolean).length;
  if (words > 150) { warnings.push(`${words} words. Replies drop sharply past ~100; aim for 50–100`); score += 10; }
  else if (words > 110) { warnings.push(`${words} words. Aim for 50–100 for cold outreach`); score += 4; }
  if (/!\[[^\]]*\]\([^)]+\)|<img\b/i.test(body)) {
    warnings.push("Images in a cold email hurt inbox placement; send plain text");
    score += 10;
  }

  if (subject.length > 100) { warnings.push("Subject is unusually long"); score += 5; }
  if (subject.length < 4) { warnings.push("Subject is suspiciously short / blank"); score += 10; }

  const textOnly = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").trim();
  if (textOnly.length < 80) { warnings.push("Body is very short — may look like spam"); score += 8; }

  // naive emoji check
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(subject)) {
    warnings.push("Emoji in subject — reduces deliverability for cold outreach");
    score += 10;
  }

  return { score: Math.min(100, score), warnings };
}

export function spamLevel(score: number): "clean" | "caution" | "risky" {
  if (score < 15) return "clean";
  if (score < 40) return "caution";
  return "risky";
}
