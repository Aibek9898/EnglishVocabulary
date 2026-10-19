import { parseCloze } from './cloze';
import { normalize, stripPlaceholders } from './check';
import type { ItemContent } from './types';

/** Light verbs in all their forms, so a swap keeps the tense of the example. */
const FORMS: Record<string, Record<string, string>> = {
  make: { base: 'make', s: 'makes', ing: 'making', past: 'made', pp: 'made' },
  do: { base: 'do', s: 'does', ing: 'doing', past: 'did', pp: 'done' },
  take: { base: 'take', s: 'takes', ing: 'taking', past: 'took', pp: 'taken' },
  have: { base: 'have', s: 'has', ing: 'having', past: 'had', pp: 'had' },
  get: { base: 'get', s: 'gets', ing: 'getting', past: 'got', pp: 'got' },
};
const SWAP: Record<string, string[]> = { make: ['do', 'take'], do: ['make'], take: ['make', 'do'], have: ['make', 'take'], get: ['take'] };
const PREP_SWAP: Record<string, string> = { of: 'from', at: 'in', in: 'at', on: 'from', to: 'for', for: 'to', with: 'on', about: 'on', from: 'of' };
const PARTICLE_SWAP: Record<string, string> = { up: 'out', out: 'up', down: 'up', on: 'off', off: 'on', in: 'out', over: 'out', back: 'out' };

function findForm(word: string): [verb: string, form: string] | null {
  for (const [verb, forms] of Object.entries(FORMS)) {
    for (const [form, value] of Object.entries(forms)) if (value === word) return [verb, form];
  }
  return null;
}

/** Wrong versions quoted in the trap text: "Not 'take a decision' (calque…)". */
function fromTrap(item: ItemContent): string[] {
  const out: string[] = [];
  const termWords = new Set(stripPlaceholders(item.term).split(' ').filter((w) => w.length > 2));
  for (const clause of item.trap.match(/\b(?:not|never|don't say|avoid)\b[^;.:]*/gi) ?? []) {
    for (const m of clause.matchAll(/['"‘“]([^'"’”]+)['"’”]/g)) {
      const raw = m[1].trim();
      // "take/accept a decision" -> both options
      const slash = raw.match(/^(\S+)\/(\S+)(.*)$/);
      const options = slash ? [slash[1] + slash[3], slash[2] + slash[3]] : [raw];
      for (const o of options) {
        const words = normalize(o).split(' ');
        if (words.length >= 2 && words.some((w) => termWords.has(w))) out.push(o.trim());
      }
    }
  }
  return out;
}

/** Rule-based mistakes on the target as it appears in the example. */
function fromRules(item: ItemContent): string[] {
  const target = parseCloze(item.example, item.term)?.answer ?? stripPlaceholders(item.term);
  const words = target.split(' ');
  const out: string[] = [];
  const lower = words.map((w) => w.toLowerCase());

  const form = findForm(lower[0]);
  if (form && item.type !== 'phrasal-verb') {
    for (const alt of SWAP[form[0]] ?? []) out.push([FORMS[alt][form[1]], ...words.slice(1)].join(' '));
  }
  const last = lower[lower.length - 1];
  if (item.type === 'phrasal-verb') {
    const i = lower.findIndex((w, k) => k > 0 && PARTICLE_SWAP[w]);
    if (i > 0) out.push([...words.slice(0, i), PARTICLE_SWAP[lower[i]], ...words.slice(i + 1)].join(' '));
  } else if (words.length >= 2 && PREP_SWAP[last]) {
    out.push([...words.slice(0, -1), PREP_SWAP[last]].join(' '));
  }
  if (item.tags.includes('articles')) {
    if (lower.includes('the')) out.push(words.filter((w) => w.toLowerCase() !== 'the').join(' '));
    else if (lower.includes('a')) out.push(words.map((w) => (w.toLowerCase() === 'a' ? 'the' : w)).join(' '));
    else if (words.length >= 2) out.push([words[0], 'the', ...words.slice(1)].join(' '));
  }
  return out;
}

/**
 * Typical wrong versions of an item, most convincing first. Never returns the
 * right answer, one of its collocations, or another item's term.
 */
export function wrongForms(item: ItemContent, otherTerms: Iterable<string> = []): string[] {
  const banned = new Set(
    [item.term, ...item.collocations, ...item.pattern.split('/'), ...(parseCloze(item.example, item.term) ? [parseCloze(item.example, item.term)!.answer] : [])]
      .map((t) => stripPlaceholders(t))
      .filter(Boolean),
  );
  for (const t of otherTerms) banned.add(stripPlaceholders(t));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of [...(item.wrong ?? []), ...fromTrap(item), ...fromRules(item)]) {
    const key = stripPlaceholders(c);
    if (!key || banned.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}
