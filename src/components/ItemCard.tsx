import { parseCloze, plainExample } from '../lib/cloze';
import { LEVEL_NAMES, type Item, type ItemContent } from '../lib/types';
import { Speak } from './Speak';

/** The example sentence with the target highlighted. */
export function Example({ item }: { item: Pick<ItemContent, 'example' | 'term'> }) {
  const c = parseCloze(item.example, item.term);
  if (!c) return <>{plainExample(item.example)}</>;
  return (
    <>
      {c.before}
      <mark>{c.answer}</mark>
      {c.after}
    </>
  );
}

export function LevelDots({ level }: { level: number }) {
  return (
    <span className="dots" title={`Level ${level}: ${LEVEL_NAMES[level]}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= level ? 'dot on' : 'dot'} />
      ))}
    </span>
  );
}

const TYPE_LABEL: Record<string, string> = {
  collocation: 'collocation',
  'phrasal-verb': 'phrasal verb',
  idiom: 'idiom',
  phrase: 'phrase',
  word: 'word',
};

/** Everything known about an item, used for introductions and feedback. */
export function ItemCard({ item, compact = false }: { item: ItemContent | Item; compact?: boolean }) {
  return (
    <div className="item-card">
      <div className="item-head">
        <h2 className="term">{item.term}</h2>
        <Speak text={item.term} />
        <span className="chip">{TYPE_LABEL[item.type] ?? item.type}</span>
        {'level' in item && <LevelDots level={item.level} />}
      </div>
      <p className="translation">{item.translation}</p>
      {item.definition && <p className="definition">{item.definition}</p>}
      {item.example && (
        <p className="example">
          <Example item={item} /> <Speak text={plainExample(item.example)} label="Listen to the example" />
          {item.exampleRu && !compact && <span className="example-ru">{item.exampleRu}</span>}
        </p>
      )}
      {!compact && item.collocations.length > 0 && (
        <p className="meta">
          <b>Also:</b> {item.collocations.join(' · ')}
        </p>
      )}
      {!compact && item.pattern && (
        <p className="meta">
          <b>Pattern:</b> {item.pattern}
        </p>
      )}
      {item.trap && <p className="trap">⚠️ {item.trap}</p>}
    </div>
  );
}
