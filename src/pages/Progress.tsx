import { useMemo } from 'react';
import { Icon } from '../components/Icon';
import { Ring, usePageTitle } from '../components/ui';
import { addDays, dayKey } from '../lib/dates';
import { db, useLive } from '../lib/db';
import { MILESTONES, MIN_DAY, activityByDay, computeStreak, dueOn, levelCounts, retention, usable } from '../lib/stats';
import { LEVEL_NAMES, type Item, type ReviewEntry } from '../lib/types';

const LEVEL_HELP = [
  'Not started yet',
  'You have met it',
  'You recognise it',
  'You can recall it',
  'You wrote with it and recalled it later',
  'Remembered for weeks',
];

export function Progress() {
  usePageTitle('Progress');
  const items = useLive(() => db.items.toArray(), [], null as Item[] | null);
  const reviews = useLive(() => db.reviews.toArray(), [], null as ReviewEntry[] | null);
  const byDay = useMemo(() => activityByDay(reviews ?? []), [reviews]);
  if (!items || !reviews) return null;

  const streak = computeStreak(byDay);
  const counts = levelCounts(items);
  const usableNow = usable(items);
  const ret = retention(reviews);
  const tomorrow = dueOn(items, addDays(new Date(), 1));
  const next = MILESTONES.find((m) => m > usableNow) ?? usableNow;
  const prev = [...MILESTONES].reverse().find((m) => m <= usableNow) ?? 0;
  const sentences = items.reduce((n, i) => n + i.mySentences.length, 0);
  const inLife = items.reduce((n, i) => n + i.usedInLife, 0);
  const max = Math.max(1, ...counts);
  const week = 7 * 864e5;
  const thisWeek = reviews.filter((r) => r.at > Date.now() - week).length;
  const lastWeek = reviews.filter((r) => r.at <= Date.now() - week && r.at > Date.now() - 2 * week).length;
  const first = reviews.reduce((m, r) => Math.min(m, r.at), Date.now());
  const weeks = Date.now() - first < 8 * week ? 8 : 20;

  return (
    <section className="page">
      <div className="page-head">
        <h1>Progress</h1>
      </div>

      <div className="card hero">
        <Ring value={usableNow - prev} max={Math.max(1, next - prev)} size={88} label={`${usableNow} words you can use, next goal ${next}`}>
          {usableNow}
        </Ring>
        <div>
          <h2>Words you can use</h2>
          <p className="muted">
            {next > usableNow ? (
              <>
                Next goal: <b>{next}</b>, {next - usableNow} to go.
              </>
            ) : (
              'Every goal reached. Impressive!'
            )}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-icon flame">
            <Icon name="flame" size={20} />
          </span>
          <span className="stat-num">{streak.current}</span>
          <span className="stat-label">
            day streak{streak.freezes ? ` · ${streak.freezes} freeze${streak.freezes > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-icon ok">
            <Icon name="target" size={20} />
          </span>
          <span className="stat-num">{ret === null ? '–' : `${Math.round(ret * 100)}%`}</span>
          <span className="stat-label">{ret === null ? 'remembered · needs 10 reviews' : 'remembered (30 days)'}</span>
        </div>
        <div className="stat">
          <span className="stat-icon">
            <Icon name="reset" size={20} />
          </span>
          <span className="stat-num">{tomorrow}</span>
          <span className="stat-label">reviews tomorrow</span>
        </div>
        <div className="stat">
          <span className="stat-icon gold">
            <Icon name="star" size={20} />
          </span>
          <span className="stat-num">{streak.best}</span>
          <span className="stat-label">best streak</span>
        </div>
      </div>

      <div className="card">
        <h2>Activity</h2>
        <Heatmap byDay={byDay} weeks={weeks} />
        <p className="muted small">
          {thisWeek} answers this week{lastWeek ? `, ${lastWeek} the week before` : ''}. A day counts after {MIN_DAY} answers. Every 7 active days earn a freeze that covers a missed day (up to 2).
          {!streak.activeToday && streak.current > 0 && ' Do a few today to keep your streak.'}
        </p>
      </div>

      <div className="card">
        <h2>Your words by level</h2>
        <div className="levels">
          {counts.map((n, level) => (
            <div key={level} className="level-row" title={LEVEL_HELP[level]}>
              <span className="level-name">{LEVEL_NAMES[level]}</span>
              <div className="bar" role="img" aria-label={`${LEVEL_NAMES[level]}: ${n}`}>
                <div className={`bar-fill l${level}`} style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <span className="level-n">{n}</span>
            </div>
          ))}
        </div>
        <p className="muted small">A word reaches “Used” when you write your own sentence with it and then recall it on another day. It becomes “Mastered” when you keep remembering it for three weeks or more.</p>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-icon">
            <Icon name="library" size={20} />
          </span>
          <span className="stat-num">{items.length}</span>
          <span className="stat-label">in your library</span>
        </div>
        <div className="stat">
          <span className="stat-icon">
            <Icon name="pen" size={20} />
          </span>
          <span className="stat-num">{sentences}</span>
          <span className="stat-label">own sentences</span>
        </div>
        <div className="stat">
          <span className="stat-icon ok">
            <Icon name="hand" size={20} />
          </span>
          <span className="stat-num">{inLife}</span>
          <span className="stat-label">used in real life</span>
        </div>
      </div>
    </section>
  );
}

function Heatmap({ byDay, weeks }: { byDay: Map<string, number>; weeks: number }) {
  const today = new Date();
  // Start on a Monday so columns are weeks.
  const start = addDays(today, -(weeks * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days: Date[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) days.push(d);
  const shade = (n: number) => (n === 0 ? 0 : n < MIN_DAY ? 1 : n < 20 ? 2 : n < 50 ? 3 : 4);
  const todayKey = dayKey(today);
  const active = days.filter((d) => (byDay.get(dayKey(d)) ?? 0) >= MIN_DAY).length;
  return (
    <>
      <div className="heatmap" role="img" aria-label={`${active} active days in the last ${weeks} weeks`}>
        {days.map((d) => {
          const key = dayKey(d);
          const n = byDay.get(key) ?? 0;
          return <span key={key} className={`cell s${shade(n)}${key === todayKey ? ' today' : ''}`} title={`${d.toLocaleDateString()}: ${n} answers`} />;
        })}
      </div>
      <div className="heat-legend" aria-hidden="true">
        Less
        {[0, 1, 2, 3, 4].map((s) => (
          <span key={s} className={`cell s${s}`} />
        ))}
        More
      </div>
    </>
  );
}
