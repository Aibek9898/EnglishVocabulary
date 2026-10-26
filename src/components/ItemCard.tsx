import { parseCloze, plainExample } from '../lib/cloze';
import type { Item, ItemContent } from '../lib/types';
import { Icon } from './Icon';
import { Speak } from './Speak';
import { LevelMeter } from './ui';

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

export const TYPE_LABEL: Record<string, string> = {
  collocation: 'collocation',
  'phrasal-verb': 'phrasal verb',
  idiom: 'idiom',
  phrase: 'phrase',
  word: 'word',
};

/** Everything known about an item, used for introductions, feedback and the library. */
export function ItemCard({ item, compact = false, heading = 'h2' }: { item: ItemContent | Item; compact?: boolean; heading?: 'h2' | 'h3' }) {
  const H = heading;
  const wrong = (item.wrong ?? []).slice(0, 3);
  return (
    <div className="item-card">
      <div className="item-head">
        <H className="term">{item.term}</H>
        <Speak text={item.term} />
      </div>
      <div className="item-sub">
        {item.ipa && (
          <span className="ipa" aria-label="Pronunciation">
            [{item.ipa}]
          </span>
        )}
        <span className="chip">{TYPE_LABEL[item.type] ?? item.type}</span>
        {'level' in item && item.level > 0 && <LevelMeter level={item.level} />}
      </div>
      <p className="translation" lang="ru">
        {item.translation}
      </p>
      {item.definition && <p className="definition">{item.definition}</p>}
      {item.example && (
        <div className="example-row">
          <p className="example">
            <Example item={item} />
            {item.exampleRu && !compact && (
              <span className="example-ru" lang="ru">
                {item.exampleRu}
              </span>
            )}
          </p>
          <Speak text={plainExample(item.example)} label="Listen to the example" small />
        </div>
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
      {item.trap && (
        <div className="trap">
          <Icon name="alert" size={18} />
          <div>
            <span>{item.trap}</span>
            {wrong.length > 0 && (
              <div className="wrong-forms" aria-label="Common mistakes">
                {wrong.map((w) => (
                  <span key={w} className="chip bad">
                    <s>{w}</s>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
