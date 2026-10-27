import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Sheet, toast, usePageTitle } from '../components/ui';
import { logout } from '../lib/auth';
import { downloadJson, isBackup, makeBackup, restoreBackup, type Backup } from '../lib/backup';
import { dayKey } from '../lib/dates';
import { db, saveSettings, useLive, useSettings } from '../lib/db';
import { canSpeak, englishVoices, speak } from '../lib/speech';
import { getTheme, setTheme, type Theme } from '../lib/theme';

const GOALS = [5, 7, 10, 15];
const OLDER = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
];
const INTENSITY = [
  { value: 0.85, label: 'Light', note: 'Fewer reviews; you forget a bit more.' },
  { value: 0.9, label: 'Balanced', note: 'Recommended: about 9 in 10 words remembered.' },
  { value: 0.95, label: 'Intense', note: 'Many more reviews for a small gain.' },
];
const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  usePageTitle('Settings');
  const settings = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [wipe, setWipe] = useState(false);
  const [error, setError] = useState('');
  const lastBackup = useLive(async () => (await db.kv.get('lastBackup'))?.value as number | undefined, [], undefined);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(englishVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const exportAll = async () => {
    const data = await makeBackup();
    const name = `vocabulary-backup-${dayKey()}.json`;
    const blob = new File([JSON.stringify(data)], name, { type: 'application/json' });
    // On phones the share sheet can save straight to Files, Drive or a chat.
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    let done = false;
    if (touch && navigator.canShare?.({ files: [blob] })) {
      try {
        await navigator.share({ files: [blob], title: 'Vocab backup' });
        done = true;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    if (!done) downloadJson(data, name);
    await db.kv.put({ key: 'lastBackup', value: Date.now() });
    toast(`Backup saved: ${data.items.length} words`);
  };

  const readFile = async (f: File) => {
    setError('');
    try {
      const data = JSON.parse(await f.text());
      if (!isBackup(data)) {
        setError('This file is not a backup from this app. To add words, use Add → From an AI chat.');
        return;
      }
      setRestore(data);
    } catch {
      setError('Could not read this file.');
    }
  };

  const rate = settings.speechRate;
  const intensity = INTENSITY.find((i) => i.value === settings.retention) ?? INTENSITY[1];
  const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86_400_000) : null;

  return (
    <section className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="card">
        <h2>Daily plan</h2>
        <div className="field">
          <span>New words per day</span>
          <Segmented
            label="New words per day"
            value={settings.newPerDay}
            options={[...new Set([...GOALS, settings.newPerDay])].sort((a, b) => a - b).map((n) => ({ value: n, label: String(n) }))}
            onChange={(n) => saveSettings({ newPerDay: n })}
          />
        </div>
        <div className="field">
          <span>Older words each day</span>
          <Segmented
            label="Older words each day"
            value={settings.oldPerDay}
            options={OLDER.some((o) => o.value === settings.oldPerDay) ? OLDER : [...OLDER, { value: settings.oldPerDay, label: String(settings.oldPerDay) }].sort((a, b) => a.value - b.value)}
            onChange={(n) => saveSettings({ oldPerDay: n })}
          />
          <small>
            {settings.oldPerDay
              ? `After the new words, each day's lesson checks at least ${settings.oldPerDay} words from earlier days, the ones closest to being forgotten first.`
              : 'Only the reviews that are due come back.'}
          </small>
        </div>
        <div className="field">
          <span>Review intensity</span>
          <Segmented label="Review intensity" value={intensity.value} options={INTENSITY} onChange={(v) => saveSettings({ retention: v })} />
          <small>{intensity.note}</small>
        </div>
        <label className="field">
          <span>Most reviews in one lesson</span>
          <input
            type="number"
            inputMode="numeric"
            min={5}
            max={300}
            value={settings.reviewCap}
            onChange={(e) => saveSettings({ reviewCap: Math.max(5, Math.min(300, +e.target.value || 40)) })}
          />
          <small>New words pause while more reviews than this are waiting, so the pile never gets out of hand.</small>
        </label>
      </div>

      <div className="card">
        <h2>Appearance</h2>
        <div className="field">
          <span>Theme</span>
          <Segmented
            label="Theme"
            value={theme}
            options={THEMES}
            onChange={(t) => {
              setTheme(t);
              setThemeState(t);
            }}
          />
        </div>
      </div>

      {canSpeak && (
        <div className="card">
          <h2>Voice</h2>
          <label className="field">
            <span>Voice</span>
            <select value={settings.voiceName} onChange={(e) => saveSettings({ voiceName: e.target.value })}>
              <option value="">Automatic</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              Speed <output className="muted">{rate.toFixed(rate * 10 === Math.round(rate * 10) ? 1 : 2)}×</output>
            </span>
            <input type="range" min={0.6} max={1.3} step={0.05} value={rate} onChange={(e) => saveSettings({ speechRate: +e.target.value })} />
          </label>
          <button type="button" onClick={() => speak('I need to make a decision by Friday.')}>
            <Icon name="volume" /> Test the voice
          </button>
        </div>
      )}

      <div className="card">
        <h2>Backup</h2>
        <p className="muted small">
          Your words live in this browser only, so your phone and computer each keep their own copy. To move your progress, save a backup on one device and restore it on the other.
        </p>
        {days !== null && <p className="small">Last backup: {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.</p>}
        <div className="row">
          <button type="button" className="primary" onClick={exportAll}>
            <Icon name="download" /> Save backup
          </button>
          <button type="button" onClick={() => file.current?.click()}>
            <Icon name="upload" /> Restore…
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {error && (
          <p className="hint-line" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Account</h2>
        <p className="muted small">Signed in as aibek. Signing out keeps your words on this device.</p>
        <button type="button" onClick={logout}>
          <Icon name="logout" /> Sign out
        </button>
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <button type="button" className="danger" onClick={() => setWipe(true)}>
          <Icon name="trash" /> Delete all data
        </button>
      </div>

      <Sheet open={!!restore} onClose={() => setRestore(null)} label="Restore backup">
        {restore && (
          <>
            <h2>Restore this backup?</h2>
            <p>
              It's from {new Date(restore.exportedAt).toLocaleString()} and has {restore.items.length} words. Everything on this device will be replaced.
            </p>
            <div className="row">
              <button type="button" className="ghost" onClick={() => setRestore(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  await restoreBackup(restore);
                  toast(`Restored ${restore.items.length} words`);
                  setRestore(null);
                }}
              >
                Replace and restore
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={wipe} onClose={() => setWipe(false)} label="Delete all data">
        <h2>Delete everything?</h2>
        <p>All words and progress on this device will be gone. Save a backup first if you might need it.</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setWipe(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await db.transaction('rw', db.items, db.reviews, async () => {
                await db.items.clear();
                await db.reviews.clear();
              });
              setWipe(false);
              toast('All data deleted', 'trash');
            }}
          >
            Delete all data
          </button>
        </div>
      </Sheet>
    </section>
  );
}
