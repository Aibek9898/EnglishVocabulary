import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../components/ui';
import { canVerify, checkLogin, startSession } from '../lib/auth';

const LOCK_AFTER = 5;
const LOCK_SECONDS = 30;

/** Phrases drifting in the background of the sign-in screen. */
const CHIPS: { text: string; style: CSSProperties }[] = [
  { text: 'make a decision', style: { top: '9%', left: '6%', '--tilt': '-6deg' } as CSSProperties },
  { text: 'run out of time', style: { top: '16%', right: '5%', '--tilt': '5deg', animationDelay: '-3s' } as CSSProperties },
  { text: 'look forward to', style: { bottom: '18%', left: '4%', '--tilt': '4deg', animationDelay: '-6s' } as CSSProperties },
  { text: 'on second thought', style: { bottom: '9%', right: '7%', '--tilt': '-4deg', animationDelay: '-2s' } as CSSProperties },
  { text: 'get the hang of it', style: { top: '44%', left: '-2%', '--tilt': '-3deg', animationDelay: '-8s' } as CSSProperties },
];

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  usePageTitle('Sign in');

  const locked = now < lockedUntil;
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || Date.now() < lockedUntil) return;
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
    setShake(true);
    passwordRef.current?.focus();
    if (n % LOCK_AFTER === 0) {
      setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
      setNow(Date.now());
      setError('Too many attempts.');
    } else {
      setError('Wrong username or password.');
    }
  };

  const wait = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

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
          {!canVerify ? (
            <p className="login-error" role="alert">
              <Icon name="alert" size={18} />
              Open the site over https (or on localhost) to sign in.
            </p>
          ) : (
            <>
              <label className="field">
                <span>Username</span>
                <span className="input-icon">
                  <Icon name="user" size={20} />
                  <input
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
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
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    onClick={() => setShow(!show)}
                  >
                    <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
                  </button>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Keep me signed in on this device
              </label>
              <div aria-live="assertive">
                {error && (
                  <p className="login-error">
                    <Icon name="alert" size={18} />
                    {locked ? `${error} Try again in ${wait} s.` : error}
                  </p>
                )}
              </div>
              <button className="primary big block" type="submit" disabled={busy || locked || !username || !password}>
                {busy ? <span className="spinner" aria-label="Checking" /> : 'Sign in'}
              </button>
            </>
          )}
        </form>
        <p className="login-foot">
          <Icon name="lock" size={14} /> Your words stay on this device.
        </p>
      </main>
    </div>
  );
}
