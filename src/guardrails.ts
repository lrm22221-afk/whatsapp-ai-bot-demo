const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i,
  /disregard (your|all|the) (instructions|rules)/i,
  /(reveal|show|print|repeat) (me )?(your |the )?(system|hidden|initial) (prompt|instructions)/i,
  /\bsystem prompt\b/i,
  /you are now\b/i,
  /\b(developer|dan|god) mode\b/i,
  /\bjailbreak\b/i,
  /act as (an? )?(unrestricted|unfiltered)/i,
  /התעלם\S* מ\S*\s*(כל\s+)?ה?הוראות/,
  /(תתעלם|התעלם|שכח)\S*\s+(מ)?(כל\s+)?ה?(הוראות|כללים)/,
  /הנחיות המערכת|פרומפט המערכת|הפרומפט שלך/,
  /אתה עכשיו\s/,
];

export function isPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

const MONEY = /(\d[\d,.]*)\s*(₪|ils|nis|ש"ח|ש״ח|שקל\S*|\$|usd|dollars?)|(₪|\$)\s*(\d[\d,.]*)/gi;

/** Every amount of money in the answer must literally appear in the retrieved context. */
export function hasUngroundedPrice(answer: string, context: string): boolean {
  const ctxNumbers = new Set((context.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "")));
  for (const m of answer.matchAll(MONEY)) {
    const num = (m[1] ?? m[4] ?? "").replace(/[,.]$/, "");
    if (!ctxNumbers.has(num)) return true;
  }
  return false;
}
