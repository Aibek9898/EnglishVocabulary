import { useMemo } from 'react';
import { db, useLive } from '../lib/db';
import { addDays, dayKey } from '../lib/dates';
import { MILESTONES, MIN_DAY, activityByDay, computeStreak, dueOn, levelCounts, retention, usable } from '../lib/stats';
import { LEVEL_NAMES, type Item, type ReviewEntry } from '../lib/types';

const WEEKS = 20;

export function Progress() {
  const items = useLive(() => db.items.toArray(), [], [] as Item[]);
  const reviews = useLive(() => db.reviews.toArray(), [], [] as ReviewEntry[]);
  const byDay = useMemo(() => activityByDay(reviews), [reviews]);
  const streak = computeStreak(byDay);
  const counts = levelCounts(items);
  const usableNow = usable(items);
  const ret = retention(reviews);
  const tomorrow = dueOn(items, addDays(new Date(), 1));
  const next = MILESTONES.find((m) => m > usableNow);
  const sentences = items.reduce((n, i) => n + i.mySentences.length, 0);
  const inLife = items.reduce((n, i) => n + i.usedInLife, 0);
  const max = Math.max(1, ...counts);

  const thisWeek = reviews.filter((r) => r.at > Date.now() - 7 * 864e5).length;
  const lastWeek = reviews.filter((r) => r.at <= Date.now() - 7 * 864e5 && r.at > Date.now() - 14 * 864e5).length;

  return (
    <section className="page">
      <h1>Progress</h1>
      <div className="stat-row">
        <div className="stat accent">
          <span className="stat-num">{usableNow}</span>
          <span className="stat-label">words you can use</span>
        </div>
        <div className="stat">
          <span className="stat-num">🔥 {streak.current}</span>
          <span className="stat-label">
            day streak{streak.freezes ? ` · ❄️ ${streak.freezes} freeze${streak.freezes > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-num">{ret === null ? '–' : `${Math.round(ret * 100)}%`}</span>
          <span className="stat-label">remembered (30 days)</span>
        </div>
        <div className="stat">
          <span className="stat-num">{tomorrow}</span>
          <span className="stat-label">reviews due tomorrow</span>
        </div>
      </div>
      {next && (
        <div className="card">
          <p>
            Next goal: <b>{next} usable words</b>. {next - usableNow} to go.
          </p>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(usableNow / next) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="card">
        <h3>Activity</h3>
        <Heatmap byDay={byDay} />
        <p className="muted small">
          {thisWeek} exercises this week{lastWeek ? `, ${lastWeek} the week before` : ''}. A day counts for the streak after {MIN_DAY} exercises; every 7 active days give you a freeze for a missed day (max 2).
          {!streak.activeToday && streak.current > 0 && ' Do a few exercises today to keep your streak.'}
        </p>
      </div>
      <div className="card">
        <h3>Your words by level</h3>
        <div className="levels">
          {counts.map((n, level) => (
            <div key={level} className="level-row">
              <span className="level-name">
                {level} · {LEVEL_NAMES[level]}
              </span>
              <div className="bar">
                <div className={`bar-fill l${level}`} style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <span className="level-n">{n}</span>
            </div>
          ))}
        </div>
        <p className="muted small">
          A word reaches “Used” when you have recalled it and written your own sentence with it. It becomes “Mastered” after you keep remembering it for 3 weeks or more.
        </p>
      </div>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{items.length}</span>
          <span className="stat-label">in library</span>
        </div>
        <div className="stat">
          <span className="stat-num">{sentences}</span>
          <span className="stat-label">own sentences</span>
        </div>
        <div className="stat">
          <span className="stat-num">{inLife}</span>
          <span className="stat-label">used in real life</span>
        </div>
        <div className="stat">
          <span className="stat-num">{streak.best}</span>
          <span className="stat-label">best streak</span>
        </div>
      </div>
    </section>
  );
}

function Heatmap({ byDay }: { byDay: Map<string, number> }) {
  const today = new Date();
  // Start on a Monday WEEKS weeks ago so columns are weeks.
  const start = addDays(today, -(WEEKS * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days: Date[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) days.push(d);
  const shade = (n: number) => (n === 0 ? 0 : n < MIN_DAY ? 1 : n < 20 ? 2 : n < 50 ? 3 : 4);
  return (
    <div className="heatmap" role="img" aria-label="Activity over the last months">
      {days.map((d) => {
        const n = byDay.get(dayKey(d)) ?? 0;
        return <span key={dayKey(d)} className={`cell s${shade(n)}`} title={`${d.toLocaleDateString()}: ${n} exercises`} />;
      })}
    </div>
  );
}
