import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../components/ui';
import { canVerify, checkLogin, checkSecondStep, getTwoFactor, startSession } from '../lib/auth';

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
  // Second step, when two-step sign-in is on for this device.
  const [stage, setStage] = useState<'password' | 'code'>('password');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
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

  const failed = (message: string) => {
    const n = fails + 1;
    setFails(n);
    setShake(true);
    if (n % LOCK_AFTER === 0) {
      setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
      setNow(Date.now());
      setError('Too many attempts.');
    } else {
      setError(message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || Date.now() < lockedUntil) return;
    setBusy(true);
    setError('');
    if (stage === 'code') {
      const r = await checkSecondStep(code);
      setBusy(false);
      if (r.ok) {
        startSession(remember);
        onSuccess();
        return;
      }
      setCode('');
      codeRef.current?.focus();
      if (r.reason === 'used') setError('That code was just used. Wait for the next one.');
      else failed(recovery ? "That recovery code doesn't work." : "That code doesn't match.");
      return;
    }
    const ok = await checkLogin(username, password);
    setBusy(false);
    if (ok) {
      if (getTwoFactor()) {
        setStage('code');
        setPassword('');
        setFails(0);
        return;
      }
      startSession(remember);
      onSuccess();
      return;
    }
    setPassword('');
    passwordRef.current?.focus();
    failed('Wrong username or password.');
  };

  const back = () => {
    setStage('password');
    setCode('');
    setRecovery(false);
    setError('');
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
          ) : stage === 'code' ? (
            <>
              <div className="login-step">
                <h2>
                  <Icon name="shield" size={22} /> Two-step sign-in
                </h2>
                <p className="muted small">
                  {recovery ? 'Type one of your recovery codes. Each one works once.' : 'Open Google Authenticator and type the 6‑digit code for Vocab.'}
                </p>
              </div>
              <label className="field">
                <span>{recovery ? 'Recovery code' : 'Code'}</span>
                <span className="input-icon">
                  <Icon name={recovery ? 'key' : 'shield'} size={20} />
                  <input
                    ref={codeRef}
                    key={recovery ? 'recovery' : 'otp'}
                    name={recovery ? 'recovery-code' : 'one-time-code'}
                    className="tf-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode={recovery ? 'text' : 'numeric'}
                    autoComplete={recovery ? 'off' : 'one-time-code'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={recovery ? 24 : 7}
                    placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
                    enterKeyHint="go"
                    autoFocus
                  />
                </span>
              </label>
              <div aria-live="assertive">
                {error && (
                  <p className="login-error">
                    <Icon name="alert" size={18} />
                    {locked ? `${error} Try again in ${wait} s.` : error}
                  </p>
                )}
              </div>
              <button className="primary big block" type="submit" disabled={busy || locked || !code.trim()}>
                {busy ? <span className="spinner" aria-label="Checking" /> : 'Verify'}
              </button>
              <div className="login-alt">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setRecovery(!recovery);
                    setCode('');
                    setError('');
                  }}
                >
                  {recovery ? 'Use the code from the app' : 'Lost your phone? Use a recovery code'}
                </button>
                <button type="button" className="link-btn" onClick={back}>
                  Back
                </button>
              </div>
            </>
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
