import { useState } from 'react';
import { canVerify, checkLogin, startSession } from '../lib/auth';

const LOCK_AFTER = 5;
const LOCK_SECONDS = 30;

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      setError(`Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)} s.`);
      return;
    }
    setBusy(true);
    setError('');
    const ok = await checkLogin(username, password);
    setBusy(false);
    if (ok) {
      startSession(remember);
      onSuccess();
      return;
    }
    const n = fails + 1;
    setFails(n);
    setPassword('');
    if (n % LOCK_AFTER === 0) {
      setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
      setError(`Too many attempts. Try again in ${LOCK_SECONDS} s.`);
    } else {
      setError('Wrong username or password.');
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo" aria-hidden="true">
          Aa
        </div>
        <h1>Vocab Trainer</h1>
        <p className="muted">Sign in to continue learning.</p>
        {!canVerify ? (
          <p className="hint">Open the site over https (or on localhost) to sign in.</p>
        ) : (
          <>
            <label className="field">
              <span>Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me signed in on this device
            </label>
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary block" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
