import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from './components/Icon';
import { MoveLegacyPrompt } from './components/AccountSettings';
import { SaveSelection } from './components/SaveSelection';
import { Toaster } from './components/ui';
import { isLoggedIn } from './lib/auth';
import { cloudEnabled, initAuth, type Account } from './lib/cloud';
import { db, openAccountDb, useLive } from './lib/db';
import { syncPacks } from './lib/decks';
import { activityByDay, computeStreak } from './lib/stats';
import { startAutoSync, syncNow } from './lib/sync';
import { AddWords } from './pages/AddWords';
import { CloudLogin, Opening } from './pages/CloudLogin';
import { Grammar } from './pages/Grammar';
import { Library } from './pages/Library';
import { Login } from './pages/Login';
import { Practice } from './pages/Practice';
import { Progress } from './pages/Progress';
import { Reading } from './pages/Reading';
import { SettingsPage } from './pages/Settings';
import { Today } from './pages/Today';

function parseHash() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { page: path || 'today', params: new URLSearchParams(query) };
}

const NAV: { id: string; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'practice', label: 'Practice', icon: 'gamepad' },
  { id: 'grammar', label: 'Grammar', icon: 'cap' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'reading', label: 'Read', icon: 'book' },
  { id: 'add', label: 'Add', icon: 'plus' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
];

export function App() {
  return cloudEnabled ? <CloudApp /> : <LocalApp />;
}

/** One learner, words in this browser, the old password gate. */
function LocalApp() {
  const [authed, setAuthed] = useState(isLoggedIn);
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <Shell />;
}

/** How long the first sync may hold the app before it opens with what this device has. */
const FIRST_SYNC_WAIT = 10_000;

let opening: string | null = null;

/** Accounts: sign in, open this account's words, bring them up to date, then the app. */
function CloudApp() {
  const [phase, setPhase] = useState<'start' | 'signin' | 'opening' | 'ready'>('start');

  const open = async (account: Account) => {
    if (opening === account.id) return;
    opening = account.id;
    setPhase('opening');
    openAccountDb(account.id);
    // Get the words from the cloud first, so a new device doesn't start an empty library.
    await Promise.race([syncNow().catch(() => null), new Promise((r) => setTimeout(r, FIRST_SYNC_WAIT))]);
    await syncPacks().catch(console.error);
    setPhase('ready');
  };

  useEffect(() => {
    initAuth().then(
      (a) => (a ? open(a) : setPhase('signin')),
      () => setPhase('signin'),
    );
  }, []);

  if (phase === 'start') return <Opening text="Opening…" />;
  if (phase === 'signin') return <CloudLogin onSuccess={open} />;
  if (phase === 'opening') return <Opening />;
  return (
    <>
      <Shell />
      <MoveLegacyPrompt />
    </>
  );
}

function Shell() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    startAutoSync().catch(console.error);
  }, []);
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
    case 'grammar':
      page = <Grammar />;
      break;
    case 'library':
      page = <Library tab={tab} />;
      break;
    case 'add':
      page = <AddWords tab={tab} />;
      break;
    case 'reading':
      page = <Reading bookId={route.params.get('book')} />;
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
            <a key={n.id} href={`#/${n.id}`} title={n.label} aria-current={current === n.id ? 'page' : undefined}>
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
      <SaveSelection />
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
