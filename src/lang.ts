export type Lang = "he" | "en";

/** Picks Hebrew when at least a third of the letters are Hebrew; falls back to the given default. */
export function detectLanguage(text: string, fallback: Lang = "en"): Lang {
  const he = (text.match(/[\u05D0-\u05EA]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (he === 0 && en === 0) return fallback;
  // Israeli users often mix English words into Hebrew, so Hebrew wins at >= 1/3 of the letters.
  return he * 2 >= en ? "he" : "en";
}
