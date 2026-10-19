import { createEmptyCard, type Card } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import everyday from '../data/decks/everyday-life.json';
import feelings from '../data/decks/feelings-opinions.json';
import phrasal from '../data/decks/phrasal-verbs.json';
import traps from '../data/decks/russian-traps.json';
import travel from '../data/decks/travel-money-health.json';
import work from '../data/decks/work-meetings.json';
import { toContent } from '../lib/content';
import {
  AMBIGUOUS_PHRASES,
  LIGHT_VERBS,
  VERB_PHRASES,
  aiCheckPrompt,
  allTags,
  blitzDeck,
  buildItems,
  buildMistakeRounds,
  buildRound,
  buildRounds,
  cleanTokens,
  defaultScope,
  distractorWords,
  formatTime,
  gameBlocker,
  isAmbiguousPhrase,
  isRightTap,
  mistakeItems,
  mistakeTokens,
  pickDistinct,
  pickTargets,
  repliesToSave,
  sameSentence,
  scopeItems,
  scoreTitle,
  sentenceTokens,
  shuffle,
  sorterCards,
  splitLightVerb,
  tokenize,
  usableWrongs,
  usedTargets,
  withWrongForm,
} from '../lib/games';
import { SCENARIOS } from '../lib/scenarios';
import type { Item } from '../lib/types';

/** Deterministic random numbers so rounds are reproducible. */
function seeded(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 0;
function toItem(raw: unknown, patch: Partial<Item> = {}): Item {
  return {
    ...toContent(raw)!,
    id: `i${nextId++}`,
    deck: 'pack',
    createdAt: 0,
    level: 1,
    card: createEmptyCard(new Date(0)),
    mySentences: [],
    usedInLife: 0,
    suspended: false,
    ...patch,
  };
}

function item(term: string, patch: Partial<Item> = {}, raw: Record<string, unknown> = {}): Item {
  return toItem({ term, translation: `перевод ${term}`, example: `I [${term}] today.`, ...raw }, patch);
}

const DECKS = [everyday, feelings, phrasal, traps, travel, work];
const ALL = DECKS.flatMap((d) => d.items.map((i) => toItem(i)));
const byTerm = (term: string) => ALL.find((i) => i.term === term)!;

describe('shuffle and picking', () => {
  it('shuffles without losing or adding elements', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(list, seeded(1));
    expect([...out].sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('picks items with distinct terms and translations', () => {
    const a = item('make a decision');
    const b = item('make a decision', {}, { translation: 'другое' });
    const c = item('take a photo', {}, { translation: a.translation });
    const d = item('do research');
    expect(pickDistinct([a, b, c, d], 5, seeded()).length).toBe(2);
  });
});

describe('scope', () => {
  const started = item('one', { level: 3 });
  const weak = item('two', { level: 1 });
  const lapsed = item('three', { level: 4, card: { ...createEmptyCard(new Date(0)), lapses: 2 } as Card });
  const fresh = item('four', { level: 0 }, { tags: ['work'] });
  const paused = item('five', { level: 2, suspended: true }, { tags: ['work'] });
  const items = [started, weak, lapsed, fresh, paused];

  it('filters by started, weak, everything and tag, never suspended', () => {
    expect(scopeItems(items, 'started').map((i) => i.term)).toEqual(['one', 'two', 'three']);
    expect(scopeItems(items, 'weak').map((i) => i.term)).toEqual(['two', 'three']);
    expect(scopeItems(items, 'all')).toHaveLength(4);
    expect(scopeItems(items, 'tag:work').map((i) => i.term)).toEqual(['four']);
  });
  it('defaults to Everything with fewer than 5 started words', () => {
    expect(defaultScope(items)).toBe('all');
    const many = Array.from({ length: 5 }, (_, k) => item(`w${k}`, { level: 1 }));
    expect(defaultScope(many)).toBe('started');
  });
  it('lists the tags of active items', () => {
    expect(allTags(items)).toEqual(['work']);
  });
});

describe('gameBlocker', () => {
  it('lets the sorter and role-play run with no words at all', () => {
    expect(gameBlocker('sorter', [])).toBeNull();
    expect(gameBlocker('roleplay', [])).toBeNull();
  });
  it('explains why a game cannot run', () => {
    expect(gameBlocker('pairs', ALL.slice(0, 3))).toBe('Needs 5 words');
    const noExamples = Array.from({ length: 6 }, (_, k) => item(`w${k}`, {}, { example: '' }));
    expect(gameBlocker('typing', noExamples)).toBe('Needs 5 words with examples');
    expect(gameBlocker('mistake', noExamples)).toBe('Needs 5 words with typical mistakes');
    expect(gameBlocker('build', noExamples)).toBe('Needs 5 words with short examples');
  });
  it('lets every game run with a real pack', () => {
    const pack = traps.items.map((i) => toItem(i));
    for (const g of ['blitz', 'mistake', 'build', 'pairs', 'quiz', 'typing', 'dictation', 'flashcards'] as const) {
      expect(gameBlocker(g, pack)).toBeNull();
    }
  });
});

describe('scoring', () => {
  it('names the result', () => {
    expect(scoreTitle(10, 10)).toBe('Perfect!');
    expect(scoreTitle(8, 10)).toBe('Great job!');
    expect(scoreTitle(5, 10)).toBe('Nice work!');
    expect(scoreTitle(2, 10)).toBe('Keep going!');
    expect(scoreTitle(0, 0)).toBe('Done!');
  });
  it('formats seconds as m:ss', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(-3)).toBe('0:00');
  });
});

describe('make / do / take / have', () => {
  it('has about 40+ unambiguous built-in phrases, balanced across the verbs', () => {
    expect(VERB_PHRASES.length).toBeGreaterThanOrEqual(40);
    for (const v of LIGHT_VERBS) expect(VERB_PHRASES.filter((p) => p.verb === v).length).toBeGreaterThanOrEqual(10);
    const keys = VERB_PHRASES.map((p) => p.phrase);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of VERB_PHRASES) {
      expect(isAmbiguousPhrase(p.phrase), p.phrase).toBe(false);
      expect(p.ru).toMatch(/\p{Script=Cyrillic}/u);
    }
  });
  it('excludes the classic two-verb phrases', () => {
    for (const p of ['a shower', 'a break', 'a look', 'a seat', 'a decision', 'notes', 'exercise']) expect(AMBIGUOUS_PHRASES.has(p)).toBe(true);
  });
  it('splits a light verb from the rest of the term', () => {
    expect(splitLightVerb('make a mistake')).toEqual({ verb: 'make', phrase: 'a mistake' });
    expect(splitLightVerb('take part in sth')).toEqual({ verb: 'take', phrase: 'part in' });
    expect(splitLightVerb("take sb's side")).toEqual({ verb: 'take', phrase: "someone's side" });
    expect(splitLightVerb('do sb a favour')).toEqual({ verb: 'do', phrase: 'someone a favour' });
    expect(splitLightVerb('take sth personally')).toEqual({ verb: 'take', phrase: 'it personally' });
    expect(splitLightVerb('get a refund')).toBeNull();
    expect(splitLightVerb('make')).toBeNull();
    expect(splitLightVerb('drop sb/sth off')).toBeNull();
  });
  it('builds 12 cards: library collocations first, never ambiguous ones or phrasal verbs', () => {
    const pool = [byTerm('make a mistake'), byTerm('do research'), byTerm('take a shower'), byTerm('make a decision'), byTerm('take off'), byTerm('get a refund')];
    const cards = sorterCards(pool, ALL, 12, seeded(3));
    expect(cards).toHaveLength(12);
    const fromLibrary = cards.filter((c) => !c.id.startsWith('builtin:'));
    expect(fromLibrary.map((c) => `${c.verb} ${c.phrase}`).sort()).toEqual(['do research', 'make a mistake']);
    expect(cards.some((c) => c.phrase === 'a shower' || c.phrase === 'a decision' || c.phrase === 'off')).toBe(false);
    expect(new Set(cards.map((c) => c.phrase)).size).toBe(12);
  });
  it('balances the verbs when topping up from the built-in list', () => {
    const cards = sorterCards([], [], 12, seeded(9));
    for (const v of LIGHT_VERBS) expect(cards.filter((c) => c.verb === v)).toHaveLength(3);
  });
  it('links a built-in card to a library item with the same term', () => {
    const lib = item('take a risk', { level: 0 });
    const cards = sorterCards([], [lib], VERB_PHRASES.length, seeded(5));
    expect(cards.find((c) => c.phrase === 'a risk')?.itemId).toBe(lib.id);
  });
  it('turns every light-verb collocation in the packs into a sensible card', () => {
    const cards = sorterCards(ALL, ALL, 100, seeded(1)).filter((c) => !c.id.startsWith('builtin:'));
    const phrases = cards.map((c) => `${c.verb} ${c.phrase}`);
    expect(phrases).toContain('make a mistake');
    expect(phrases).toContain('take a photo');
    expect(phrases).toContain('do someone a favour');
    expect(phrases).not.toContain('take a shower');
    expect(phrases).not.toContain('have breakfast');
  });
});

describe('tokens', () => {
  it('keeps punctuation attached and glues a lone dash to the word before', () => {
    expect(tokenize('Hi Tom, how are you?')).toEqual(['Hi', 'Tom,', 'how', 'are', 'you?']);
    expect(tokenize("Let's eat — I'm hungry.")).toEqual(["Let's", 'eat —', "I'm", 'hungry.']);
  });
  it('removes brackets from example sentences', () => {
    expect(sentenceTokens('I [made a mistake] again.')).toEqual(['I', 'made', 'a', 'mistake', 'again.']);
  });
});

describe('sentences with a wrong form', () => {
  it('swaps the wrong form into the example', () => {
    const w = withWrongForm('I [made a mistake] in the report.', 'did a mistake')!;
    expect(w.sentence).toBe('I did a mistake in the report.');
    expect(w.rightSentence).toBe('I made a mistake in the report.');
    expect(w.right).toBe('made a mistake');
  });
  it('keeps the capital letter at the start of a sentence', () => {
    expect(withWrongForm('[In my opinion], it works.', 'on my opinion')!.sentence).toBe('On my opinion, it works.');
    expect(withWrongForm('She is [interested in] art.', 'Interested about')!.sentence).toBe('She is interested about art.');
  });
  it('refuses a wrong form that is the right one, or a sentence without brackets', () => {
    expect(withWrongForm('I [made a mistake].', 'Made a mistake')).toBeNull();
    expect(withWrongForm('I made a mistake.', 'did a mistake')).toBeNull();
  });
  it('marks only the word that differs as the mistake', () => {
    const tokens = mistakeTokens(withWrongForm('I [made a mistake] in the report.', 'did a mistake')!);
    expect(tokens.filter((t) => t.hot).map((t) => t.text)).toEqual(['did']);
    expect(tokens.filter((t) => t.target).map((t) => t.text)).toEqual(['did', 'a', 'mistake']);
  });
  it('marks the words around a missing word', () => {
    const tokens = mistakeTokens(withWrongForm('I [listen to] podcasts every morning.', 'listen')!);
    expect(tokens.filter((t) => t.hot).map((t) => t.text)).toEqual(['listen', 'podcasts']);
    const article = mistakeTokens(withWrongForm('Eat [a balanced diet] daily.', 'balanced diet')!);
    expect(article.filter((t) => t.hot).map((t) => t.text)).toEqual(['Eat', 'balanced']);
  });
  it('handles punctuation glued to the target', () => {
    const tokens = mistakeTokens(withWrongForm('[In my opinion], the plan works.', 'On my opinion')!);
    expect(tokens.filter((t) => t.hot).map((t) => t.text)).toEqual(['On']);
  });
  it('finds a hot word for every typical mistake in the packs', () => {
    for (const i of mistakeItems(ALL)) {
      for (const wrong of usableWrongs(i)) {
        const tokens = mistakeTokens(withWrongForm(i.example, wrong)!);
        expect(tokens.some((t) => t.hot), `${i.term}: ${wrong}`).toBe(true);
      }
    }
  });
  it('marks the target in a correct sentence without hot words', () => {
    const tokens = cleanTokens('We [take turns] cooking.');
    expect(tokens.filter((t) => t.target).map((t) => t.text)).toEqual(['take', 'turns']);
    expect(tokens.some((t) => t.hot)).toBe(false);
  });
});

describe('Find the mistake', () => {
  const rounds = buildMistakeRounds(ALL, 10, seeded(7));
  it('builds 10 rounds, about 30% without a mistake, starting with a mistake', () => {
    expect(rounds).toHaveLength(10);
    expect(rounds.filter((r) => !r.hasMistake)).toHaveLength(3);
    expect(rounds[0].hasMistake).toBe(true);
    expect(new Set(rounds.map((r) => r.item.id)).size).toBe(10);
  });
  it('only uses items with typical mistakes', () => {
    expect(rounds.every((r) => (r.item.wrong ?? []).length > 0)).toBe(true);
    const plain = item('reliable', {}, { wrong: [] });
    expect(buildMistakeRounds([plain], 10, seeded())).toHaveLength(0);
  });
  it('scores taps', () => {
    const r = rounds.find((x) => x.hasMistake)!;
    const hot = r.tokens.findIndex((t) => t.hot);
    const cold = r.tokens.findIndex((t) => !t.hot);
    expect(isRightTap(r, hot)).toBe(true);
    expect(isRightTap(r, cold)).toBe(false);
    expect(isRightTap(r, null)).toBe(false);
    const ok = rounds.find((x) => !x.hasMistake)!;
    expect(isRightTap(ok, null)).toBe(true);
    expect(isRightTap(ok, 0)).toBe(false);
  });
});

describe('Build the sentence', () => {
  const made = byTerm('take a photo');
  it('only uses examples with a Russian translation and at most 12 words', () => {
    const long = item('x', {}, { example: 'One two three four five six seven eight nine ten eleven twelve thirteen.', exampleRu: 'Да' });
    const noRu = item('y', {}, { exampleRu: '' });
    expect(buildItems([made, long, noRu, byTerm('make a mistake')])).toEqual([made]);
    expect(buildItems(ALL).every((i) => sentenceTokens(i.example).length <= 12)).toBe(true);
  });
  it('adds up to two distractors from the typical mistakes, never words of the sentence', () => {
    const words = sentenceTokens(made.example);
    const extra = distractorWords(made, words, 2, seeded());
    expect(extra.length).toBeLessThanOrEqual(2);
    expect(extra.sort()).toEqual(['do', 'make']);
    for (const w of extra) expect(words.map((x) => x.toLowerCase())).not.toContain(w.toLowerCase());
  });
  it('builds a shuffled round whose words make the answer', () => {
    const round = buildRound(made, seeded(2));
    expect(round.prompt).toBe(made.exampleRu);
    expect(round.tiles).toHaveLength(sentenceTokens(made.example).length + round.distractors);
    const tilesInOrder = sentenceTokens(made.example).join(' ');
    expect(sameSentence(tilesInOrder, round.answer)).toBe(true);
    expect(sameSentence(round.tiles.map((t) => t.text).join(' '), round.answer)).toBe(false);
  });
  it('builds 8 rounds from a pack', () => {
    expect(buildRounds(ALL, 8, seeded())).toHaveLength(8);
  });
  it('compares ignoring case and the final punctuation', () => {
    expect(sameSentence('i made a mistake in the report', 'I made a mistake in the report.')).toBe(true);
    expect(sameSentence('What a shame', 'What a shame!')).toBe(true);
    expect(sameSentence('It’s fine.', "it's fine")).toBe(true);
    expect(sameSentence('the report made a mistake in I', 'I made a mistake in the report.')).toBe(false);
  });
});

describe('Natural or not? (blitz)', () => {
  const pool = mistakeItems(ALL).slice(0, 12);
  const deck = blitzDeck(pool, seeded(4));
  it('shows every word twice: once natural, once with a mistake', () => {
    expect(deck).toHaveLength(24);
    expect(deck.filter((s) => s.natural)).toHaveLength(12);
    for (const i of pool) {
      const mine = deck.filter((s) => s.item.id === i.id);
      expect(mine.map((s) => s.natural).sort()).toEqual([false, true]);
    }
  });
  it('puts a real mistake in the unnatural sentences', () => {
    for (const s of deck) {
      if (s.natural) expect(s.text).toBe(s.right);
      else expect(sameSentence(s.text, s.right)).toBe(false);
      expect(s.text).not.toMatch(/[[\]]/);
    }
  });
  it('never shows the same word twice in a row', () => {
    for (let k = 1; k < deck.length; k++) expect(deck[k].item.id).not.toBe(deck[k - 1].item.id);
  });
});

describe('role-play', () => {
  const meeting = item('set up a meeting', { level: 3 }, { tags: ['work', 'meetings'] });
  const deadline = item('meet a deadline', { level: 5 }, { tags: ['work'] });
  const cold = item('catch a cold', { level: 2 }, { tags: ['health'] });
  const sleep = item('sleep in', { level: 1 }, { tags: ['daily'] });
  const fresh = item('take minutes', { level: 0 }, { tags: ['meetings'] });

  it('picks started words, tagged like the scenario first, then levels 2–4', () => {
    const targets = pickTargets([meeting, deadline, cold, sleep, fresh], ['meetings', 'work'], 4, seeded());
    expect(targets.map((t) => t.term)).toEqual(['set up a meeting', 'meet a deadline', 'catch a cold', 'sleep in']);
  });
  it('falls back to any word when fewer than 3 are started', () => {
    const targets = pickTargets([meeting, fresh], ['meetings'], 4, seeded());
    expect(targets).toHaveLength(2);
  });
  it('ticks targets used in any reply and saves one reply per word', () => {
    const replies = ["I'll set up a meeting with the client.", 'We set up a meeting and met the deadline.', 'No idea.'];
    expect([...usedTargets(replies, [meeting, deadline, cold])].sort()).toEqual([deadline.id, meeting.id].sort());
    const saves = repliesToSave(replies, [meeting, deadline, cold]);
    expect(saves).toEqual([
      { item: meeting, text: replies[0] },
      { item: deadline, text: replies[1] },
    ]);
  });
  it('writes a prompt for an AI check', () => {
    const text = aiCheckPrompt(SCENARIOS[0], [meeting, deadline], [
      { who: 'partner', text: 'Tell me about yourself.' },
      { who: 'me', text: 'I am project manager.' },
    ]);
    expect(text.startsWith("I'm learning English (B2). Please correct my replies in this role-play.")).toBe(true);
    expect(text).toContain('Keep my style. Target phrases: set up a meeting, meet a deadline.');
    expect(text).toContain('Interviewer: Tell me about yourself.');
    expect(text).toContain('Me: I am project manager.');
  });
  it('has about 15 scenarios where the partner always asks something', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    const packTags = new Set(ALL.flatMap((i) => i.tags));
    for (const s of SCENARIOS) {
      expect(s.lines.length).toBeGreaterThanOrEqual(4);
      expect(s.lines.length).toBeLessThanOrEqual(5);
      for (const line of s.lines) expect(line, s.id).toContain('?');
      expect(s.tags.some((t) => packTags.has(t)), s.id).toBe(true);
      expect(s.setting && s.partner && s.closing && s.title).toBeTruthy();
    }
  });
});
