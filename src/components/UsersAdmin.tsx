import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AuthError, createUser, deleteUser, listUsers, newPassword, resetPassword, type UserRow } from '../lib/cloud';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';

const SITE = typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname;

/** What to send a new learner: where to go and how to sign in. */
const invite = (email: string, password: string) => `Vocab: ${SITE}\nEmail: ${email}\nPassword: ${password}\nYou can change the password in Settings → Account.`;

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'copy');
  } catch {
    toast("Couldn't copy. Select the text and copy it.", 'alert');
  }
}

/** Admin only: make accounts for other learners, reset their password, or remove them. */
export function UsersAdmin({ me }: { me: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<{ email: string; password: string; title: string } | null>(null);
  const [removing, setRemoving] = useState<UserRow | null>(null);

  const load = useCallback(() => {
    setError('');
    listUsers().then(setUsers, (e) => setError(e instanceof AuthError ? e.message : "Couldn't load the accounts."));
  }, []);
  useEffect(load, [load]);

  const reset = async (u: UserRow) => {
    const password = newPassword();
    try {
      await resetPassword(u.id, password);
      setMade({ email: u.email, password, title: 'New password' });
    } catch (e) {
      toast(e instanceof AuthError ? e.message : "Couldn't reset the password.", 'alert');
    }
  };

  return (
    <div className="card ai-settings" id="users">
      <h2>
        <Icon name="user" /> Users
      </h2>
      <p className="muted small">Only people you add here can sign in. Each has their own words and progress.</p>
      {error && (
        <p className="hint-line small" role="alert">
          {error}
        </p>
      )}
      {users === null && !error && <span className="spinner" aria-label="Loading" />}
      {users && (
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id}>
              <span>
                <b>{u.name || u.email}</b>
                <small className="muted">
                  {u.name ? `${u.email} · ` : ''}
                  {u.isAdmin ? 'admin · ' : ''}
                  {u.lastSignIn ? `last signed in ${new Date(u.lastSignIn).toLocaleDateString()}` : 'not signed in yet'}
                </small>
              </span>
              {u.id !== me && (
                <span className="row">
                  <button type="button" className="small" onClick={() => reset(u)}>
                    <Icon name="key" size={16} /> New password
                  </button>
                  <button type="button" className="small ghost" aria-label={`Remove ${u.email}`} onClick={() => setRemoving(u)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => setAdding(true)}>
          <Icon name="add" /> Add a user
        </button>
      </div>

      <AddUserSheet
        open={adding}
        onClose={() => setAdding(false)}
        onDone={(email, password) => {
          setAdding(false);
          setMade({ email, password, title: 'Account created' });
          load();
        }}
      />

      <Sheet open={!!made} onClose={() => setMade(null)} label="Sign-in details">
        {made && (
          <>
            <h2>{made.title}</h2>
            <p>Send these to the learner. The password is shown only now.</p>
            <pre className="invite-box">{invite(made.email, made.password)}</pre>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setMade(null)}>
                Done
              </button>
              <button type="button" className="primary" onClick={() => copy(invite(made.email, made.password))}>
                <Icon name="copy" /> Copy
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={!!removing} onClose={() => setRemoving(null)} label="Remove user">
        {removing && (
          <>
            <h2>Remove {removing.name || removing.email}?</h2>
            <p>Their account, words, progress and books are deleted for good.</p>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const u = removing;
                  setRemoving(null);
                  try {
                    await deleteUser(u.id);
                    toast(`Removed ${u.email}`, 'trash');
                    load();
                  } catch (e) {
                    toast(e instanceof AuthError ? e.message : "Couldn't remove the account.", 'alert');
                  }
                }}
              >
                Remove
              </button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

function AddUserSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (email: string, password: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(newPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError('Type a full email address.');
    if (password.length < 8) return setError('The password needs at least 8 characters.');
    setBusy(true);
    setError('');
    try {
      await createUser(mail, password, name.trim());
      onDone(mail, password);
      setEmail('');
      setName('');
      setPassword(newPassword());
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label="Add a user">
      <h2>Add a user</h2>
      <form className="stack-form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <p className="muted small">
          They can sign in right away and change the password in Settings.{' '}
          <button type="button" className="link-btn" onClick={() => setPassword(newPassword())}>
            Make another password
          </button>
        </p>
        {error && (
          <p className="hint-line small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !email.trim()}>
            {busy ? <span className="spinner" aria-label="Creating" /> : 'Create account'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
