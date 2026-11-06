// Deterministic prompt-injection heuristic (Requirement 5.2).
//
// Independent of the model: runs over untrusted Intent_Text and returns only
// pattern ids (never the matched text) so results are audit-safe. It is a
// tripwire, not a guarantee; combine and the rules engine are the real guards.

export interface InjectionResult {
  hit: boolean;
  /** Ids of the patterns that matched. Never contains input text. */
  patterns: string[];
}

const PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  {
    id: "override_instructions",
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|the|your)\b[^.]{0,40}\b(instructions?|rules?|prompts?|polic(?:y|ies)|limits?|caps?|guardrails?)\b/,
  },
  {
    id: "force_approval",
    re: /\b(approve|approved|auto[- ]?approve)\b[^.]{0,30}\b(this|it|now|immediately|regardless|without)\b/,
  },
  { id: "claims_approved_json", re: /["']?approved["']?\s*:\s*true/ },
  { id: "claims_flag_false", re: /["']?flagprompt\w*["']?\s*:\s*false/ },
  { id: "role_tag_spoof", re: /(<\|?\s*(system|assistant|user)\s*\|?>|\[\/?(inst|system)\]|^\s*(system|assistant)\s*:)/m },
  { id: "role_reassign", re: /\b(you are now|act as|pretend (?:to be|you are)|new instructions?)\b/ },
  { id: "reveal_prompt", re: /\b(reveal|show|print|repeat)\b[^.]{0,30}\b(system prompt|instructions|api key|secret)\b/ },
  { id: "data_block_escape", re: /(untrusted[_ -]?(?:data|intent)|<\/?\s*(?:intent|data)[a-z_ -]*>|end of (?:data|input))/ },
];

/** Lowercase, NFKC-normalise, and drop zero-width / control characters used to evade matching. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "")
    .toLowerCase();
}

/**
 * Scan one or more Intent_Text strings. Undefined / empty entries are ignored.
 * Pure and total.
 */
export function detectInjection(texts: ReadonlyArray<string | undefined> | string | undefined): InjectionResult {
  const list = Array.isArray(texts) ? texts : [texts as string | undefined];
  const found = new Set<string>();
  for (const t of list) {
    if (!t) continue;
    const text = normalise(t);
    for (const { id, re } of PATTERNS) {
      if (re.test(text)) found.add(id);
    }
  }
  const patterns = [...found];
  return { hit: patterns.length > 0, patterns };
}
