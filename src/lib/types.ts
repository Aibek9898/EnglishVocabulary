import type { Card } from 'ts-fsrs';

export type ItemType = 'collocation' | 'phrasal-verb' | 'idiom' | 'phrase' | 'word';

/** What a word or phrase card says. Packs, the add form and AI imports all produce this. */
export interface ItemContent {
  term: string;
  type: ItemType;
  translation: string;
  definition: string;
  /** Example sentence; the target is wrapped in [square brackets]. */
  example: string;
  exampleRu: string;
  collocations: string[];
  pattern: string;
  trap: string;
  tags: string[];
  source?: string;
  /** Typical wrong versions of the target, e.g. ["do a mistake"]. */
  wrong?: string[];
}

export interface MySentence {
  text: string;
  at: number;
}

export interface Item extends ItemContent {
  id: string;
  /** Pack id, or 'own' for words the learner added. */
  deck: string;
  createdAt: number;
  /** Mastery 0..5: new, seen, recognised, recalled, used, mastered. */
  level: number;
  card: Card;
  mySentences: MySentence[];
  usedInLife: number;
  suspended: boolean;
  /** Answers the learner marked as also right ("I was right"). */
  accepted?: string[];
}

export type ExerciseKind =
  | 'intro'
  | 'choice'
  | 'cloze'
  | 'cloze-ru'
  | 'recall'
  | 'dictation'
  | 'sentence'
  | 'say'
  | 'pairs'
  | 'flashcard'
  | 'game';

/**
 * correct / almost (typo) / hinted (needed a hint: counts as not remembered) /
 * wrong / done (no right or wrong, e.g. an intro).
 */
export type Result = 'correct' | 'almost' | 'hinted' | 'wrong' | 'done';

export interface ReviewEntry {
  id?: number;
  itemId: string;
  at: number;
  /** Local date, YYYY-MM-DD. */
  day: string;
  exercise: ExerciseKind;
  result: Result;
  /** True when it was a scheduled review that updated the FSRS card. */
  scheduled: boolean;
}

export interface Settings {
  newPerDay: number;
  reviewCap: number;
  voiceName: string;
  speechRate: number;
  retention: number;
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 7,
  reviewCap: 40,
  voiceName: '',
  speechRate: 0.95,
  retention: 0.9,
};

export const LEVEL_NAMES = ['New', 'Seen', 'Recognised', 'Recalled', 'Used', 'Mastered'] as const;

export interface Deck {
  id: string;
  title: string;
  description: string;
  items: ItemContent[];
}
