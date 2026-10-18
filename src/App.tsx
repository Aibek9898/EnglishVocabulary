import { useEffect, useState } from 'react';
import { AddWords } from './pages/AddWords';
import { Library } from './pages/Library';
import { Practice } from './pages/Practice';
import { Progress } from './pages/Progress';
import { SettingsPage } from './pages/Settings';
import { Today } from './pages/Today';

function parseHash() {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { page: path || 'today', params: new URLSearchParams(query) };
}

const NAV = [
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'practice', label: 'Practice', icon: '🎮' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'add', label: 'Add', icon: '➕' },
  { id: 'progress', label: 'Progress', icon: '📈' },
];

export function App() {
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
  let page;
  switch (route.page) {
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
        <a href="#/today" className="brand">
          <span className="logo">Aa</span> Vocab
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={route.page === n.id || (n.id === 'today' && !NAV.some((x) => x.id === route.page) && route.page !== 'settings') ? 'on' : ''}>
              <span className="nav-icon">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
        <a href="#/settings" className={route.page === 'settings' ? 'settings-link on' : 'settings-link'} aria-label="Settings">
          ⚙️
        </a>
      </header>
      <main>{page}</main>
    </div>
  );
}
