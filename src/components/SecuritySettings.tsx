import qrcode from 'qrcode-generator';
import { useMemo, useState, type FormEvent } from 'react';
import { checkSecondStep, finishSetup, ISSUER, logout, renewRecoveryCodes, startSetup, turnOffTwoFactor, USERNAME, useTwoFactor, type Setup } from '../lib/auth';
import { groupKey } from '../lib/totp';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';

type Flow = { kind: 'setup'; setup: Setup } | { kind: 'off' } | { kind: 'renew' } | { kind: 'codes'; codes: string[] };

const LABELS: Record<Flow['kind'], string> = {
  setup: 'Set up two-step sign-in',
  off: 'Turn off two-step sign-in',
  renew: 'New recovery codes',
  codes: 'Recovery codes',
};

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

async function copy(text: string, what: string) {
  try {
    if (!navigator.clipboard) throw new Error('No clipboard');
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`, 'copy');
  } catch {
    toast("Couldn't copy. Select the text and copy it yourself.", 'alert');
  }
}

/** Settings card: who is signed in, two-step sign-in with Google Authenticator, signing out. */
export function SecuritySettings() {
  const tf = useTwoFactor();
  const [flow, setFlow] = useState<Flow | null>(null);
  const left = tf?.recovery.length ?? 0;

  return (
    <div className="card ai-settings" id="security">
      <h2>
        <Icon name="shield" /> Sign-in & security
      </h2>
      <p className="muted small">
        Signed in as <b>{USERNAME}</b>. Signing out keeps your words on this device.
      </p>

      <div className="field">
        <span>Two-step sign-in</span>
        {tf ? (
          <>
            <div className="tf-status">
              <Icon name="check" size={18} />
              <span>
                <b>On for this device</b>
                <small className="muted">
                  Code from Google Authenticator ({ISSUER}, {USERNAME} on {tf.device}) · since {new Date(tf.since).toLocaleDateString()}
                </small>
              </span>
            </div>
            <small className={left <= 2 ? 'hint-line' : undefined}>
              {left === 0 ? 'No recovery codes left. Make new ones.' : `${left} recovery ${left === 1 ? 'code' : 'codes'} left.`}
            </small>
            <div className="row">
              <button type="button" onClick={() => setFlow({ kind: 'renew' })}>
                <Icon name="key" /> New recovery codes
              </button>
              <button type="button" className="ghost" onClick={() => setFlow({ kind: 'off' })}>
                Turn off
              </button>
            </div>
          </>
        ) : (
          <>
            <small>After your password, the site also asks for a 6‑digit code from Google Authenticator on your phone.</small>
            <div className="row">
              <button type="button" className="primary" onClick={() => setFlow({ kind: 'setup', setup: startSetup() })}>
                <Icon name="shield" /> Set up with Google Authenticator
              </button>
            </div>
          </>
        )}
      </div>

      <details className="ai-safety">
        <summary>
          <Icon name="lock" size={18} /> What this protects
        </summary>
        <ul className="small">
          <li>This site has no server. Your words, the password check and the two-step code all live in this browser on this device.</li>
          <li>
            It keeps out someone who picks up your phone or laptop and opens the site. It can't stop someone who knows how to read a website's code and the browser's
            storage.
          </li>
          <li>Two-step sign-in is set up per device: turn it on on your phone and on your computer, and each gets its own line in Google Authenticator.</li>
          <li>Lost your phone? Sign in with a recovery code, then turn two-step sign-in off and on again to link the new phone.</li>
        </ul>
      </details>

      <div className="row">
        <button type="button" onClick={logout}>
          <Icon name="logout" /> Sign out
        </button>
      </div>

      <Sheet open={!!flow} onClose={() => setFlow(null)} label={flow ? LABELS[flow.kind] : 'Two-step sign-in'}>
        {flow?.kind === 'setup' && <SetupStep setup={flow.setup} onDone={(codes) => setFlow({ kind: 'codes', codes })} />}
        {flow?.kind === 'off' && (
          <VerifyStep
            title="Turn off two-step sign-in?"
            text="Signing in on this device will need only the password again."
            action="Turn off"
            danger
            onOk={() => {
              turnOffTwoFactor();
              setFlow(null);
              toast('Two-step sign-in is off', 'lock');
            }}
          />
        )}
        {flow?.kind === 'renew' && (
          <VerifyStep
            title="Make new recovery codes?"
            text="The old recovery codes stop working."
            action="Make new codes"
            onOk={async () => setFlow({ kind: 'codes', codes: await renewRecoveryCodes() })}
          />
        )}
        {flow?.kind === 'codes' && <CodesStep codes={flow.codes} onDone={() => setFlow(null)} />}
      </Sheet>
    </div>
  );
}

function SetupStep({ setup, onDone }: { setup: Setup; onDone: (codes: string[]) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const touch = useMemo(isTouch, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    const r = await finishSetup(setup, code);
    setBusy(false);
    if (r.ok) {
      toast('Two-step sign-in is on', 'shield');
      onDone(r.codes);
      return;
    }
    setCode('');
    setError("That code doesn't match. Type the newest code for Vocab. If it still fails, check that your phone sets the time automatically.");
  };

  const key = (
    <details className="tf-more">
      <summary>Can't scan? Type a setup key</summary>
      <p className="small muted">In Google Authenticator tap +, then "Enter a setup key". Name it {ISSUER}, paste this key, and keep "Time based".</p>
      <div className="tf-key">
        <code aria-label="Setup key">{groupKey(setup.secret)}</code>
        <button type="button" className="small" onClick={() => copy(setup.secret, 'Setup key')}>
          <Icon name="copy" size={16} /> Copy
        </button>
      </div>
    </details>
  );

  return (
    <>
      <h2>Set up two-step sign-in</h2>
      <ol className="tf-steps">
        <li>
          Install <b>Google Authenticator</b> on your phone from the App Store or Google Play.
        </li>
        <li>
          {touch ? (
            <>
              Add {ISSUER} to it:
              <a className="button primary tf-open" href={setup.uri}>
                <Icon name="shield" /> Open in Google Authenticator
              </a>
              <details className="tf-more">
                <summary>Authenticator is on another phone? Scan a QR code</summary>
                <QrCode text={setup.uri} />
              </details>
            </>
          ) : (
            <>
              In the app tap <b>+</b>, then <b>Scan a QR code</b>:
              <QrCode text={setup.uri} />
            </>
          )}
          {key}
        </li>
        <li>
          Type the 6‑digit code the app shows for {ISSUER}:
          <form className="tf-code" onSubmit={submit}>
            <CodeInput value={code} onChange={setCode} label="Code from the app" />
            <button type="submit" className="primary" disabled={busy || !code.trim()}>
              {busy ? <span className="spinner" aria-label="Checking" /> : 'Turn on'}
            </button>
          </form>
          {error && (
            <p className="hint-line small" role="alert">
              {error}
            </p>
          )}
        </li>
      </ol>
    </>
  );
}

function CodeInput({ value, onChange, label, recovery }: { value: string; onChange: (v: string) => void; label: string; recovery?: boolean }) {
  return (
    <input
      className="tf-input"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete={recovery ? 'off' : 'one-time-code'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      maxLength={recovery ? 24 : 7}
      placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
      enterKeyHint="go"
    />
  );
}

/** Asks for a current code (or a recovery code) before changing two-step sign-in. */
function VerifyStep({ title, text, action, danger, onOk }: { title: string; text: string; action: string; danger?: boolean; onOk: () => void | Promise<void> }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    const r = await checkSecondStep(code);
    if (r.ok) {
      await onOk();
      setBusy(false);
      return;
    }
    setBusy(false);
    setCode('');
    setError(r.reason === 'used' ? 'That code was just used. Wait for the next one.' : "That code doesn't match.");
  };

  return (
    <form onSubmit={submit}>
      <h2>{title}</h2>
      <p>{text}</p>
      <label className="field">
        <span>{recovery ? 'Recovery code' : 'Code from Google Authenticator'}</span>
        <CodeInput value={code} onChange={setCode} label={recovery ? 'Recovery code' : 'Code from Google Authenticator'} recovery={recovery} />
      </label>
      {error && (
        <p className="hint-line small" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setRecovery(!recovery);
          setCode('');
          setError('');
        }}
      >
        {recovery ? 'Use the code from the app' : 'Use a recovery code instead'}
      </button>
      <div className="row end">
        <button type="submit" className={danger ? 'danger' : 'primary'} disabled={busy || !code.trim()}>
          {busy ? <span className="spinner" aria-label="Checking" /> : action}
        </button>
      </div>
    </form>
  );
}

function CodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `${ISSUER} recovery codes for ${USERNAME}\nEach code signs you in once if you lose your phone.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vocab-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <h2>Save your recovery codes</h2>
      <p>If you lose your phone, each code lets you sign in once on this device. Keep them somewhere safe, like your password manager. They won't be shown again.</p>
      <ul className="tf-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={() => copy(codes.join('\n'), 'Codes')}>
          <Icon name="copy" /> Copy
        </button>
        <button type="button" onClick={download}>
          <Icon name="download" /> Download
        </button>
      </div>
      <label className="check tf-saved">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved them
      </label>
      <button type="button" className="primary big block" disabled={!saved} onClick={onDone}>
        Done
      </button>
    </>
  );
}

/** QR code drawn as SVG; always dark on white so cameras read it in dark mode too. */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return { size: n + quiet * 2, path: d };
  }, [text]);
  return (
    <svg className="tf-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code to scan with Google Authenticator" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
