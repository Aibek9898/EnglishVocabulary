import { useEffect, useRef, useState } from 'react';
import { db, saveSettings, useSettings } from '../lib/db';
import { dayKey } from '../lib/dates';
import { downloadJson, isBackup, makeBackup, restoreBackup } from '../lib/backup';
import { logout } from '../lib/auth';
import { canSpeak, englishVoices, speak } from '../lib/speech';

export function SettingsPage() {
  const settings = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(englishVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const exportAll = async () => {
    downloadJson(await makeBackup(), `vocabulary-backup-${dayKey()}.json`);
  };

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!isBackup(data)) {
        setMsg('This file is not a backup from this app. To add words, use Add words → From an AI chat.');
        return;
      }
      if (!confirm(`Replace everything on this device with the backup from ${new Date(data.exportedAt).toLocaleString()} (${data.items.length} words)?`)) return;
      await restoreBackup(data);
      setMsg(`✓ Restored ${data.items.length} words.`);
    } catch {
      setMsg('Could not read this file.');
    }
  };

  return (
    <section className="page">
      <h1>Settings</h1>
      <div className="card">
        <h3>Daily plan</h3>
        <label className="field inline">
          <span>New words per day</span>
          <input
            type="number"
            min={0}
            max={50}
            value={settings.newPerDay}
            onChange={(e) => saveSettings({ newPerDay: Math.max(0, Math.min(50, +e.target.value || 0)) })}
          />
        </label>
        <label className="field inline">
          <span>Max reviews per session</span>
          <input
            type="number"
            min={5}
            max={300}
            value={settings.reviewCap}
            onChange={(e) => saveSettings({ reviewCap: Math.max(5, Math.min(300, +e.target.value || 40)) })}
          />
        </label>
        <label className="field inline">
          <span>Target memory</span>
          <select value={settings.retention} onChange={(e) => saveSettings({ retention: +e.target.value })}>
            <option value={0.85}>85%: fewer reviews</option>
            <option value={0.9}>90%: recommended</option>
            <option value={0.95}>95%: many more reviews</option>
          </select>
        </label>
      </div>

      {canSpeak && (
        <div className="card">
          <h3>Voice</h3>
          <label className="field inline">
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
          <label className="field inline">
            <span>Speed</span>
            <input
              type="range"
              min={0.6}
              max={1.3}
              step={0.05}
              value={settings.speechRate}
              onChange={(e) => saveSettings({ speechRate: +e.target.value })}
            />
          </label>
          <button className="ghost" onClick={() => speak('I need to make a decision by Friday.')}>
            🔊 Test
          </button>
        </div>
      )}

      <div className="card">
        <h3>Backup and moving between devices</h3>
        <p className="muted small">
          Your words are stored in this browser only. Your phone and your computer each keep their own copy. To move your progress, export a backup on one device and restore it on the other. Export a backup now and then so nothing gets lost.
        </p>
        <div className="row wrap">
          <button className="primary" onClick={exportAll}>
            Export backup
          </button>
          <button className="ghost" onClick={() => file.current?.click()}>
            Restore from backup…
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {msg && <p className="small">{msg}</p>}
      </div>

      <div className="card">
        <h3>Account</h3>
        <p className="muted small">Signing out keeps your words on this device.</p>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </div>

      <div className="card">
        <h3>Danger zone</h3>
        <button
          className="ghost danger"
          onClick={async () => {
            if (!confirm('Delete ALL words and progress on this device? Export a backup first if you might need it.')) return;
            await db.transaction('rw', db.items, db.reviews, async () => {
              await db.items.clear();
              await db.reviews.clear();
            });
            setMsg('All data deleted.');
          }}
        >
          Delete all data
        </button>
      </div>
    </section>
  );
}
