import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../components/ui';
import { AuthError, signIn, type Account } from '../lib/cloud';
import { CHIPS } from './Login';

/** Sign-in with an account (email and password). Accounts are made by the admin. */
export function CloudLogin({ onSuccess }: { onSuccess: (a: Account) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  usePageTitle('Sign in');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onSuccess(await signIn(email, password));
    } catch (err) {
      setBusy(false);
      setShake(true);
      setPassword('');
      passwordRef.current?.focus();
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <div className="login">
      <div className="floating-chips" aria-hidden="true">
        {CHIPS.map((c) => (
          <span key={c.text} style={c.style}>
            {c.text}
          </span>
        ))}
      </div>
      <main className="login-inner">
        <div className="login-head">
          <span className="app-mark" aria-hidden="true">
            <Icon name="message" size={32} strokeWidth={2.2} />
          </span>
          <h1>Vocab</h1>
          <p className="muted">Learn words you'll actually use.</p>
        </div>
        <form className={'login-card' + (shake ? ' shake' : '')} onSubmit={submit} onAnimationEnd={() => setShake(false)} noValidate>
          <label className="field">
            <span>Email</span>
            <span className="input-icon">
              <Icon name="user" size={20} />
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                enterKeyHint="next"
                required
                autoFocus
              />
            </span>
          </label>
          <label className="field">
            <span>Password</span>
            <span className="input-icon">
              <Icon name="lock" size={20} />
              <input
                ref={passwordRef}
                name="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                enterKeyHint="go"
                required
              />
              <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}>
                <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </span>
          </label>
          <div aria-live="assertive">
            {error && (
              <p className="login-error">
                <Icon name="alert" size={18} />
                {error}
              </p>
            )}
          </div>
          <button className="primary big block" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? <span className="spinner" aria-label="Signing in" /> : 'Sign in'}
          </button>
          <p className="muted small login-note">Forgot your password or need an account? Ask the person who invited you.</p>
        </form>
        <p className="login-foot">
          <Icon name="lock" size={14} /> Your words are saved to your account and work on all your devices.
        </p>
      </main>
    </div>
  );
}

/** While the account's words load before the app opens. */
export function Opening({ text = 'Loading your words…' }: { text?: string }) {
  return (
    <div className="login">
      <main className="login-inner">
        <div className="login-head">
          <span className="app-mark" aria-hidden="true">
            <Icon name="message" size={32} strokeWidth={2.2} />
          </span>
          <h1>Vocab</h1>
          <p className="muted opening" role="status">
            <span className="spinner" aria-hidden="true" /> {text}
          </p>
        </div>
      </main>
    </div>
  );
}
