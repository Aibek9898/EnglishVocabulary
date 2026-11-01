import { useEffect, useState, type FormEvent } from 'react';
import { db, useLive } from '../lib/db';
import { connect, DEFAULT_REPO, disconnect, getSyncConfig, peekRemote, saveSyncConfig, SyncError, syncNow, useSyncStatus, type SyncConfig } from '../lib/sync';
import { Icon } from './Icon';
import { QrCode } from './SecuritySettings';
import { Sheet, toast } from './ui';

const NEW_REPO = `https://github.com/new?name=${DEFAULT_REPO}&visibility=private&description=${encodeURIComponent('Vocab: synced words (private)')}`;
const NEW_KEY = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent('Vocab sync')}&description=${encodeURIComponent('Sync between my devices for the Vocab site')}`;

function ago(t?: number): string {
  if (!t) return 'not yet';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Joining a device that already has words: the recommended choice comes first. */
const REPLACE = { first: 'replace' as const, title: 'Use the synced words', text: "This device becomes a copy of your other one. What's only here is replaced." };
const COMBINE = { first: 'combine' as const, title: 'Combine both', text: 'Keeps the words and progress from both devices.' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Join {
  config: SyncConfig;
  remoteWords: number;
  localWords: number;
  practised: boolean;
}

/** Settings card: keep phone and computer in step through a private GitHub repository. */
export function SyncSettings() {
  const status = useSyncStatus();
  const config = useLive(getSyncConfig, [], undefined as SyncConfig | null | undefined);
  const [key, setKey] = useState('');
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [join, setJoin] = useState<Join | null>(null);
  const [qr, setQr] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [, tick] = useState(0);

  // Keeps "synced 2 min ago" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const finish = async (c: SyncConfig, first?: 'replace' | 'combine') => {
    await saveSyncConfig(c);
    setKey('');
    const r = await syncNow({ first: first ?? 'combine' });
    if (r) toast(first === 'replace' ? `Synced: ${plural(r.words, 'word', 'words')} from your other device` : `Sync is on: ${plural(r.words, 'word', 'words')}`, 'check');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const c = await connect(key, repo);
      const remote = await peekRemote(c);
      const localWords = await db.items.count();
      if (!remote || localWords === 0) {
        await finish(c, remote ? 'replace' : undefined);
      } else {
        setJoin({ config: c, remoteWords: remote.words, localWords, practised: (await db.reviews.count()) >= 30 });
      }
    } catch (err) {
      setError(err instanceof SyncError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (first: 'replace' | 'combine') => {
    const j = join;
    if (!j) return;
    setJoin(null);
    setBusy(true);
    try {
      await finish(j.config, first);
    } catch (err) {
      setError(err instanceof SyncError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (config === undefined) return null;

  return (
    <div className="card ai-settings" id="sync">
      <h2>
        <Icon name="sync" /> Sync between devices
      </h2>

      {config ? (
        <>
          <div className="tf-status">
            <Icon name={status.state === 'error' ? 'alert' : 'check'} size={18} />
            <span>
              <b>
                On · {config.owner}/{config.repo}
              </b>
              <small className={status.state === 'error' ? 'hint-line' : 'muted'} role={status.state === 'error' ? 'alert' : undefined}>
                {status.state === 'syncing' ? 'Syncing…' : status.state === 'error' && status.error ? status.error : `Last synced ${ago(status.lastSync ?? config.lastSync)}`}
              </small>
            </span>
          </div>
          <p className="muted small">This device syncs when you open the app, a little after you study, and when you leave it.</p>
          <div className="row">
            <button
              type="button"
              onClick={() => syncNow().then((r) => r && toast(r.changedHere ? 'Synced: new changes here' : 'Synced', 'check'), () => {})}
              disabled={status.state === 'syncing'}
            >
              {status.state === 'syncing' ? <span className="spinner" aria-hidden="true" /> : <Icon name="sync" />} Sync now
            </button>
            <button type="button" onClick={() => setQr(true)}>
              <Icon name="plus" /> Add another device
            </button>
            <button type="button" className="ghost" onClick={() => setConfirmOff(true)}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Keep your phone and computer in step on their own. Your words go to a private GitHub repository that only you can see, and each device syncs when you open it,
            a little after you study, and when you leave.
          </p>
          <ol className="tf-steps sync-steps">
            <li>
              <b>Make a private repository</b> called {DEFAULT_REPO}. Leave it <b>Private</b> and press <b>Create repository</b>.
              <div className="sync-link">
                <a className="button small" href={NEW_REPO} target="_blank" rel="noopener noreferrer">
                  <Icon name="link" size={16} /> Open GitHub
                </a>
              </div>
            </li>
            <li>
              <b>Make a key</b> that can reach only that repository:
              <ul className="small">
                <li>
                  Repository access: <b>Only select repositories</b> → {repo || DEFAULT_REPO}
                </li>
                <li>
                  Permissions → Contents: <b>Read and write</b>
                </li>
                <li>Expiration: the longest it offers. Then Generate token and copy it.</li>
              </ul>
              <div className="sync-link">
                <a className="button small" href={NEW_KEY} target="_blank" rel="noopener noreferrer">
                  <Icon name="link" size={16} /> Open GitHub
                </a>
              </div>
            </li>
            <li>
              <b>Paste the key here.</b> On your other device, paste the same key.
              <form className="sync-form" onSubmit={submit}>
                <div className="ai-key-input">
                  <input
                    type="text"
                    className={show ? '' : 'masked'}
                    aria-label="GitHub key"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setError('');
                    }}
                    placeholder="github_pat_…"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  <button type="button" className="icon-btn" aria-label={show ? 'Hide the key' : 'Show the key'} aria-pressed={show} onClick={() => setShow((s) => !s)}>
                    <Icon name="eye" size={20} />
                  </button>
                  <button type="submit" className="primary" disabled={!key.trim() || busy}>
                    {busy ? <span className="spinner" aria-label="Connecting" /> : 'Connect'}
                  </button>
                </div>
                <details className="tf-more">
                  <summary>Repository has another name?</summary>
                  <input aria-label="Repository name" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                </details>
                {error && (
                  <p className="hint-line small" role="alert">
                    {error}
                  </p>
                )}
              </form>
            </li>
          </ol>
        </>
      )}

      <details className="ai-safety">
        <summary>
          <Icon name="lock" size={18} /> How your words are kept safe
        </summary>
        <ul className="small">
          <li>The repository is private: on GitHub only you can see it. The site refuses a public one.</li>
          <li>The key works only for that one repository and only for its files. It stays in this browser, isn't in backups, and is sent only to GitHub.</li>
          <li>Each sync keeps one copy of your words there; older copies are dropped, so it stays small.</li>
          <li>Lost a device? Delete the key on GitHub (Settings → Developer settings → Personal access tokens) and make a new one.</li>
        </ul>
      </details>

      <Sheet open={!!join} onClose={() => setJoin(null)} label="This device already has words">
        {join && (
          <>
            <h2>This device already has words</h2>
            <p>
              GitHub has {plural(join.remoteWords, 'word', 'words')} from your other device. This one has {plural(join.localWords, 'word', 'words')}.
            </p>
            <div className="sync-choices">
              {(join.practised ? [COMBINE, REPLACE] : [REPLACE, COMBINE]).map((o, i) => (
                <button key={o.first} type="button" className={'sync-choice' + (i === 0 ? ' primary' : '')} onClick={() => choose(o.first)}>
                  <b>{o.title}</b>
                  <small>{o.text}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={qr} onClose={() => setQr(false)} label="Add another device">
        {qr && config && (
          <>
            <h2>Add another device</h2>
            <ol className="tf-steps">
              <li>On the other device, open Vocab → Settings → Sync between devices.</li>
              <li>Scan this code with its camera and copy the text it shows. That's your key.</li>
              <li>
                Paste it and press Connect{config.repo !== DEFAULT_REPO ? `; under "Repository has another name?" type ${config.repo}` : ''}.
              </li>
            </ol>
            <QrCode text={config.token} label="QR code with your sync key" />
            <p className="muted small">Anyone who scans this can change your synced words, so close it when you're done.</p>
          </>
        )}
      </Sheet>

      <Sheet open={confirmOff} onClose={() => setConfirmOff(false)} label="Turn off sync">
        <h2>Turn off sync on this device?</h2>
        <p>Your words stay on this device and on GitHub. This device just stops syncing until you paste the key again.</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setConfirmOff(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await disconnect();
              setConfirmOff(false);
              toast('Sync is off on this device', 'sync');
            }}
          >
            Turn off
          </button>
        </div>
      </Sheet>
    </div>
  );
}
