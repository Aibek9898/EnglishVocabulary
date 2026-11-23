import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { courseNumber } from '../lib/session';
import { isComplete, isMyLesson, lessonDeckId, lessonMessage, myLessonTitle, parseLessonAnswer, readCsv, readPasted, readXlsx, rowsToEntries } from '../lib/lessonImport';

/** A minimal .xlsx like Excel writes: shared strings, an inline string, a rich-text run, a gap column. */
function xlsx(): Uint8Array {
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Words" sheetId="1" r:id="rId3"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId3" Type="x" Target="worksheets/sheet7.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(
      '<sst><si><t>Word</t></si><si><t>Translation</t></si><si><r><t>drive sb up </t></r><r><t>the wall</t></r></si><si><t>доводить &amp; бесить</t></si><si><t>listen in on</t></si></sst>',
    ),
    'xl/worksheets/sheet7.xml': strToU8(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>4</v></c></row>' +
        '<row r="4"><c r="A4" t="inlineStr"><is><t>over the moon</t></is></c><c r="B4"><v>42</v></c></row>' +
        '</sheetData></worksheet>',
    ),
  });
}

describe('reading word lists', () => {
  it('reads the first sheet of an .xlsx, with shared, rich and inline strings', () => {
    const rows = readXlsx(xlsx());
    expect(rows[0]).toEqual(['Word', '', 'Translation']);
    expect(rows[1]).toEqual(['drive sb up the wall', '', 'доводить & бесить']);
    expect(rows[3]).toEqual(['over the moon', '42']);
  });

  it('uses a header row to find the columns', () => {
    const entries = rowsToEntries(readXlsx(xlsx()));
    expect(entries.map((e) => e.term)).toEqual(['drive sb up the wall', 'listen in on', 'over the moon']);
    expect(entries[0].given.translation).toBe('доводить & бесить');
    expect(entries[2].given.note).toBe('42');
  });

  it('reads CSV with semicolons and quotes, as Russian Excel saves it', () => {
    const rows = readCsv('слово;перевод;транскрипция\n"get on, sb\'s nerves";действовать на нервы;/ɡet ɒn ˈnɜːvz/\r\nfeel blue;грустить;\n');
    expect(rows[1]).toEqual(["get on, sb's nerves", 'действовать на нервы', '/ɡet ɒn ˈnɜːvz/']);
    const entries = rowsToEntries(rows);
    expect(entries).toHaveLength(2);
    expect(entries[0].given).toMatchObject({ translation: 'действовать на нервы', ipa: 'ɡet ɒn ˈnɜːvz' });
  });

  it('works without a header: first English column is the word, the rest by what they look like', () => {
    const entries = rowsToEntries(readPasted('1. overhear - подслушать\nspoken word\n\nspoken word\nкакой-то русский текст\n[ˈæŋɡwɪʃ]\tanguish'));
    expect(entries.map((e) => e.term)).toEqual(['overhear', 'spoken word', 'anguish']);
    expect(entries[0].given.translation).toBe('подслушать');
    expect(entries[2].given.ipa).toBe('ˈæŋɡwɪʃ');
  });
});

describe('the AI answer', () => {
  const entries = rowsToEntries(readPasted('overhear\nbe over the moon\nanguish'));
  const card = (n: number, term: string, extra = {}) => ({
    n,
    term,
    translation: 'перевод',
    definition: 'a simple explanation',
    example: `I [${term}] today.`,
    exampleRu: 'Пример.',
    ...extra,
  });

  it('numbers the lines and passes on what the list already says', () => {
    expect(lessonMessage(rowsToEntries([['overhear', 'подслушать', '/ˌəʊvəˈhɪə/']]), 5)).toBe('5. overhear (translation: подслушать; IPA: ˌəʊvəˈhɪə)');
  });

  it('matches cards by number even when the AI changes the order', () => {
    const answer = JSON.stringify({ items: [card(3, 'anguish'), card(1, 'overhear'), card(2, 'be over the moon', { tags: [] })] });
    const cards = parseLessonAnswer(answer, entries);
    expect(cards.map((c) => c?.term)).toEqual(['overhear', 'be over the moon', 'anguish']);
    expect(cards[1]?.tags).toEqual(['lesson']);
    expect(cards.every((c) => c && isComplete(c))).toBe(true);
  });

  it('leaves a gap for a word the AI skipped, and spots half-done cards', () => {
    const cards = parseLessonAnswer('```json\n[' + JSON.stringify(card(1, 'overhear')) + ',' + JSON.stringify(card(3, 'anguish', { example: 'No brackets here.' })) + ']\n```', entries);
    expect(cards[1]).toBeNull();
    expect(isComplete(cards[2]!)).toBe(false);
  });
});

describe('lessons as packs', () => {
  it('get a date title and come after every built-in course pack', () => {
    const deck = lessonDeckId(new Date(2026, 10, 23, 12), new Date(2026, 10, 23, 19, 5));
    expect(deck).toBe('course-202611231905-my-2026-11-23');
    expect(isMyLesson(deck)).toBe(true);
    expect(isMyLesson('course-11-lesson-20-november')).toBe(false);
    expect(myLessonTitle(deck)).toBe('Lesson — 23 November');
    expect(courseNumber(deck)).toBeGreaterThan(courseNumber('course-11-lesson-20-november'));
  });
});
