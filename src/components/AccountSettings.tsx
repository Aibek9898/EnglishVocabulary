import { useEffect, useState, type FormEvent } from 'react';
import { AuthError, changePassword, isAdmin, signOut, useAccount } from '../lib/cloud';
import { findLegacy, moveLegacy, type LegacyData } from '../lib/migrate';
import { syncNow, SyncError, useSyncStatus } from '../lib/sync';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';
import { UsersAdmin } from './UsersAdmin';

export function ago(t?: number): string {
  if (!t) return 'not yet';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function describe(d: LegacyData): string {
  const parts = [plural(d.words, 'word', 'words')];
  if (d.books.length) parts.push(d.books.length === 1 ? `the book "${d.books[0]}"` : plural(d.books.length, 'book', 'books'));
  return parts.join(' and ');
}

/** Moves the words from before accounts; shared by the prompt and the Settings card. */
function useMoveLegacy() {
  const account = useAccount();
  const [legacy, setLegacy] = useState<LegacyData | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    findLegacy().then(setLegacy, () => setLegacy(null));
  }, []);
  const move = async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      const moved = await moveLegacy(account.id);
      setLegacy(null);
      toast(`Moved ${describe(moved)} into your account`, 'check');
      await syncNow().catch(() => toast("Moved. It will upload when you're online.", 'alert'));
    } catch (e) {
      console.error(e);
      toast("Couldn't move them. Nothing was lost; try again.", 'alert');
    } finally {
      setBusy(false);
    }
  };
  return { legacy, busy, move };
}

const SKIP_KEY = 'vocab-move-later';

/** Asks once per visit, right after signing in on a device that has words from before accounts. */
export function MoveLegacyPrompt() {
  const account = useAccount();
  const { legacy, busy, move } = useMoveLegacy();
  const [later, setLater] = useState(() => sessionStorage.getItem(SKIP_KEY) === '1');
  if (!legacy || later || !account) return null;
  const close = () => {
    sessionStorage.setItem(SKIP_KEY, '1');
    setLater(true);
  };
  return (
    <Sheet open onClose={close} label="Move your words into your account">
      <h2>Move your words into your account?</h2>
      <p>
        This device has {describe(legacy)} from before accounts{legacy.reviews ? `, with ${plural(legacy.reviews, 'answer', 'answers')} of progress` : ''}. Move them into{' '}
        <b>{account.email}</b> to have them on all your devices.
      </p>
      <p className="muted small">Nothing is deleted here. If your account already has words, both are combined.</p>
      <div className="row">
        <button type="button" className="ghost" onClick={close}>
          Not now
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={async () => {
            await move();
            close();
          }}
        >
          {busy ? <span className="spinner" aria-label="Moving" /> : <Icon name="upload" />} Move to my account
        </button>
      </div>
    </Sheet>
  );
}

/** Settings card for accounts: who is signed in, sync, password, and Users for the admin. */
export function AccountSettings() {
  const account = useAccount();
  const status = useSyncStatus();
  const { legacy, busy, move } = useMoveLegacy();
  const [admin, setAdmin] = useState(false);
  const [pw, setPw] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    isAdmin().then(setAdmin, () => setAdmin(false));
  }, [account?.id]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!account) return null;
  return (
    <>
      <div className="card ai-settings" id="account">
        <h2>
          <Icon name="user" /> Account
        </h2>
        <div className="tf-status">
          <Icon name={status.state === 'error' ? 'alert' : 'check'} size={18} />
          <span>
            <b>{account.name ? `${account.name} · ${account.email}` : account.email}</b>
            <small className={status.state === 'error' ? 'hint-line' : 'muted'} role={status.state === 'error' ? 'alert' : undefined}>
              {status.state === 'syncing' ? 'Saving…' : status.state === 'error' && status.error ? status.error : `Saved to your account ${ago(status.lastSync)}`}
            </small>
          </span>
        </div>
        <p className="muted small">Your words, progress, books and grammar are saved to your account, so you can sign in on any device and carry on.</p>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              syncNow().then(
                (r) => r && toast(r.changedHere ? 'Synced: new changes here' : 'Synced', 'check'),
                (e) => toast(e instanceof SyncError ? e.message : 'Sync failed', 'alert'),
              )
            }
            disabled={status.state === 'syncing'}
          >
            {status.state === 'syncing' ? <span className="spinner" aria-hidden="true" /> : <Icon name="sync" />} Sync now
          </button>
          <button type="button" onClick={() => setPw(true)}>
            <Icon name="key" /> Change password
          </button>
          <button type="button" className="ghost" onClick={() => signOut()}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
        {legacy && (
          <div className="move-legacy">
            <p className="small">
              <b>This device has {describe(legacy)} from before accounts.</b> Move them into your account to keep them on all devices.
            </p>
            <button type="button" className="primary" disabled={busy} onClick={move}>
              {busy ? <span className="spinner" aria-label="Moving" /> : <Icon name="upload" />} Move to my account
            </button>
          </div>
        )}
      </div>
      {admin && <UsersAdmin me={account.id} />}
      <PasswordSheet open={pw} onClose={() => setPw(false)} />
    </>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (a.length < 8) return setError('Use at least 8 characters.');
    if (a !== b) return setError("The two passwords don't match.");
    setBusy(true);
    setError('');
    try {
      await changePassword(a);
      toast('Password changed', 'check');
      setA('');
      setB('');
      onClose();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} label="Change password">
      <h2>Change password</h2>
      <form className="stack-form" onSubmit={submit}>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field">
          <span>Repeat it</span>
          <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        </label>
        {error && (
          <p className="hint-line small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !a || !b}>
            {busy ? <span className="spinner" aria-label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
