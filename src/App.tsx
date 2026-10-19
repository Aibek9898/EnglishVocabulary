import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { Toaster } from './components/ui';
import { isLoggedIn } from './lib/auth';
import { db, useLive } from './lib/db';
import { activityByDay, computeStreak } from './lib/stats';
import { AddWords } from './pages/AddWords';
import { Library } from './pages/Library';
import { Login } from './pages/Login';
import { Practice } from './pages/Practice';
import { Progress } from './pages/Progress';
import { SettingsPage } from './pages/Settings';
import { Today } from './pages/Today';

function parseHash() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { page: path || 'today', params: new URLSearchParams(query) };
}

const NAV: { id: string; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'practice', label: 'Practice', icon: 'gamepad' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'add', label: 'Add', icon: 'plus' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
];

export function App() {
  const [authed, setAuthed] = useState(isLoggedIn);
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <Shell />;
}

function Shell() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const tab = route.params.get('tab') ?? '';
  const known = NAV.some((n) => n.id === route.page) || route.page === 'settings';
  const current = known ? route.page : 'today';
  let page;
  switch (current) {
    case 'practice':
      page = <Practice />;
      break;
    case 'library':
      page = <Library tab={tab} />;
      break;
    case 'add':
      page = <AddWords tab={tab} />;
      break;
    case 'progress':
      page = <Progress />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <Today />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/today" className="brand" aria-label="Vocab, go to Today">
          <span className="app-mark" aria-hidden="true">
            <Icon name="message" size={18} strokeWidth={2.4} />
          </span>
          <span className="brand-name">Vocab</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} aria-current={current === n.id ? 'page' : undefined}>
              <span className="nav-icon">
                <Icon name={n.icon} size={22} />
              </span>
              <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          <StreakPill />
          <a href="#/settings" className="settings-link" aria-label="Settings" aria-current={current === 'settings' ? 'page' : undefined}>
            <Icon name="settings" size={22} />
          </a>
        </div>
      </header>
      <main id="main">{page}</main>
      <Toaster />
    </div>
  );
}

/** Day streak in the header: grey until today's practice is done, then lit. */
function StreakPill() {
  const reviews = useLive(() => db.reviews.toArray(), [], null);
  const streak = useMemo(() => (reviews ? computeStreak(activityByDay(reviews)) : null), [reviews]);
  if (!streak) return null;
  const label = `${streak.current} day streak${streak.activeToday ? '' : ', practise today to keep it'}${streak.freezes ? `, ${streak.freezes} freeze${streak.freezes > 1 ? 's' : ''} saved` : ''}`;
  return (
    <a href="#/progress" className={'streak-pill' + (streak.activeToday ? ' ignite' : ' cold')} aria-label={label} title={label}>
      <Icon name="flame" size={20} />
      {streak.current}
    </a>
  );
}
