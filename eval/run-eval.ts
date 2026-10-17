/**
 * Offline evaluation of the assistant's routing and grounding on held-out phrasings
 * (none of these sentences appear verbatim in knowledge/clinic.json).
 * Exits non-zero if accuracy drops below MIN_ACCURACY (default 0.9).
 */
import { readFileSync } from "node:fs";
import { Assistant } from "../src/assistant.js";
import { Store } from "../src/store.js";
import { buildRag } from "../src/bootstrap.js";
import { detectLanguage } from "../src/lang.js";

interface Case { text: string; intent: string; expect?: string }
const cases: Case[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const { retriever, generator } = await buildRag({});
const min = Number(process.env.MIN_ACCURACY ?? 0.9);

let pass = 0;
const byIntent = new Map<string, [number, number]>();
for (const c of cases) {
  const store = new Store();
  const session = store.session("eval", detectLanguage(c.text));
  const r = await new Assistant(store, retriever, generator, 0.4, () => new Date(2026, 9, 18, 10)).handle(session, c.text);
  const ok = r.intent === c.intent && (!c.expect || (r.text ?? "").includes(c.expect));
  if (ok) pass++;
  const s = byIntent.get(c.intent) ?? [0, 0];
  byIntent.set(c.intent, [s[0] + (ok ? 1 : 0), s[1] + 1]);
  console.log(`${ok ? "PASS" : "FAIL"}  [${c.intent.padEnd(16)}] got=${r.intent.padEnd(16)} ${c.text}`);
}
console.log("\nPer intent:");
for (const [k, [p, n]] of byIntent) console.log(`  ${k.padEnd(16)} ${p}/${n}`);
const acc = pass / cases.length;
console.log(`\nAccuracy: ${pass}/${cases.length} = ${(acc * 100).toFixed(1)}% (threshold ${(min * 100).toFixed(0)}%)`);
process.exit(acc >= min ? 0 : 1);
