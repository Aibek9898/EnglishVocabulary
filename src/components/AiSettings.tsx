import { useEffect, useMemo, useState } from 'react';
import {
  activeAi,
  AiError,
  formatCost,
  keyInfo,
  listModels,
  maskKey,
  PROVIDERS,
  saveAi,
  setKey,
  suggestedModels,
  testAi,
  useAi,
  type AiConfig,
  type KeyInfo,
  type ModelInfo,
  type Provider,
} from '../lib/ai';
import { Icon } from './Icon';
import { Segmented, Sheet, toast } from './ui';

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'deepseek', label: 'DeepSeek' },
];

const LANGS = [
  { value: 'ru' as const, label: 'Russian' },
  { value: 'en' as const, label: 'English' },
];

/** DeepSeek's own API has two models; its list needs the key, so these stand in until it loads. */
const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
];
const DEEPSEEK_NOTES: Record<string, string> = {
  'deepseek-chat': 'Fast. Good for checking sentences.',
  'deepseek-reasoner': 'Thinks before it answers: slower, sometimes more careful.',
};

type Test = { state: 'busy' } | { state: 'ok'; text: string } | { state: 'error'; text: string };

/** Settings → AI teacher: the service, the key, the model and the explanation language. */
export function AiSettings() {
  const config = useAi();
  if (!config) return null;
  return <AiSettingsCard config={config} />;
}

function AiSettingsCard({ config }: { config: AiConfig }) {
  const provider = config.provider;
  const p = PROVIDERS[provider];
  const key = config.keys[provider];
  const ai = activeAi(config);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [picker, setPicker] = useState(false);
  const [test, setTest] = useState<Test | null>(null);
  const [info, setInfo] = useState<KeyInfo | null>(null);

  // Each service keeps its own key and model; switching clears what was shown for the other.
  useEffect(() => {
    setDraft('');
    setDraftError('');
    setTest(null);
    setInfo(null);
  }, [provider]);

  // The model list: OpenRouter's is public, DeepSeek's needs the key.
  const listKey = provider === 'deepseek' ? key : undefined;
  useEffect(() => {
    setModels(null);
    setModelsError('');
    if (provider === 'deepseek' && !listKey) return;
    const ctrl = new AbortController();
    listModels(provider, listKey, ctrl.signal)
      .then((list) => setModels(list.length ? list : null))
      .catch((e) => {
        if (!ctrl.signal.aborted) setModelsError(e instanceof AiError ? e.message : `Couldn't load the models from ${PROVIDERS[provider].name}.`);
      });
    return () => ctrl.abort();
  }, [provider, listKey]);

  // The key's limit or balance, so it's easy to see the key is safe to keep here.
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    keyInfo(provider, key, ctrl.signal).then((i) => !ctrl.signal.aborted && setInfo(i));
    return () => ctrl.abort();
  }, [provider, key]);

  const list = provider === 'deepseek' ? (models ?? DEEPSEEK_MODELS) : models;
  const saved = config.models[provider];
  const model = saved || p.defaultModel;
  const current = list?.find((m) => m.id === model);
  const suggested = useMemo(() => (provider === 'openrouter' && models ? suggestedModels(models) : []), [provider, models]);

  // No model picked yet: take the default if the service still has it, else the first good one.
  useEffect(() => {
    if (saved || provider !== 'openrouter' || !models) return;
    const pick = models.some((m) => m.id === p.defaultModel) ? p.defaultModel : suggested[0]?.id;
    if (pick && pick !== p.defaultModel) saveAi({ models: { ...config.models, [provider]: pick } });
  }, [saved, provider, models, suggested, p.defaultModel, config.models]);

  const runTest = async (withKey = key) => {
    if (!withKey) return;
    setTest({ state: 'busy' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      await testAi({ provider, key: withKey, model }, ctrl.signal);
      setTest({ state: 'ok', text: `It works: ${current?.name ?? model} answered.` });
    } catch (e) {
      setTest({
        state: 'error',
        text: ctrl.signal.aborted ? `${p.name} took too long to answer. Try again.` : e instanceof AiError ? e.message : 'Something went wrong. Try again.',
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const saveKey = async () => {
    const k = draft.trim();
    if (!k) return;
    if (/\s/.test(k) || k.length < 20) return setDraftError("This doesn't look like a whole key. Copy it again.");
    if (provider === 'deepseek' && k.startsWith('sk-or-')) return setDraftError('This is an OpenRouter key. Choose OpenRouter above.');
    if (provider === 'openrouter' && !k.startsWith('sk-or-')) return setDraftError('OpenRouter keys start with “sk-or-”. Is this a DeepSeek key? Choose DeepSeek above.');
    await setKey(provider, k);
    setDraft('');
    setShow(false);
    setDraftError('');
    toast('Key saved on this device', 'lock');
    runTest(k);
  };

  const removeKey = async () => {
    await setKey(provider, null);
    setConfirmRemove(false);
    setTest(null);
    setInfo(null);
    toast('Key removed from this device', 'trash');
  };

  const pickModel = (id: string) => {
    saveAi({ models: { ...config.models, [provider]: id } });
    setPicker(false);
    setTest(null);
  };

  return (
    <div className="card ai-settings" id="ai-teacher">
      <h2>
        <Icon name="sparkles" /> AI teacher
      </h2>
      <p className="muted small">
        Check the sentences you write with an AI that acts as your English teacher: is it correct, does it sound natural, how else could you say it, and which
        words would fit. It needs your own key from OpenRouter or DeepSeek; you pay them for what you use, usually a fraction of a cent for a check.
      </p>

      <div className="field">
        <span>Service</span>
        <Segmented label="AI service" value={provider} options={PROVIDER_OPTIONS} onChange={(v) => saveAi({ provider: v })} />
        <small>
          {provider === 'openrouter'
            ? 'One key for many models: DeepSeek, Gemini, GPT, Claude and more. You can set a spending limit on the key.'
            : "DeepSeek's own API: cheap, but only its own models, and there's no spending limit per key."}
        </small>
      </div>

      {key ? (
        <div className="field">
          <span>API key</span>
          <div className="ai-key">
            <Icon name="lock" size={18} />
            <code aria-label="Saved key, hidden">{maskKey(key)}</code>
            <span className="muted small">saved on this device</span>
            <button type="button" className="small ghost" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          </div>
          {info && <KeyNote info={info} provider={provider} />}
        </div>
      ) : (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            saveKey();
          }}
        >
          <label htmlFor="ai-key-input" className="field-label">
            {p.name} API key
          </label>
          <div className="ai-key-input">
            {/* A text field drawn as dots, so password managers don't mix the key up with the sign-in password. */}
            <input
              id="ai-key-input"
              type="text"
              className={show ? '' : 'masked'}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError('');
              }}
              placeholder={provider === 'openrouter' ? 'sk-or-v1-…' : 'sk-…'}
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
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Save
            </button>
          </div>
          {draftError ? (
            <small className="hint-line" role="alert">
              {draftError}
            </small>
          ) : (
            <small>
              Get one at{' '}
              <a href={p.keysPage} target="_blank" rel="noopener noreferrer">
                {p.keysPage.replace('https://', '')}
              </a>
              . {provider === 'openrouter' ? 'Make a new key just for this app and give it a credit limit, like $2.' : 'Top up only a small amount, like $2.'}
            </small>
          )}
        </form>
      )}

      <div className="field">
        <span>Model</span>
        {provider === 'deepseek' ? (
          <>
            <Segmented
              label="Model"
              value={model}
              options={(list ?? DEEPSEEK_MODELS).map((m) => ({ value: m.id, label: m.name === m.id ? m.id.replace('deepseek-', '') : m.name.replace('DeepSeek ', '') }))}
              onChange={pickModel}
            />
            {DEEPSEEK_NOTES[model] && <small>{DEEPSEEK_NOTES[model]}</small>}
          </>
        ) : (
          <>
            <button type="button" className="ai-model" onClick={() => setPicker(true)} aria-label={`Model: ${current?.name ?? model}. Change`}>
              <span>
                <b>{current?.name ?? model}</b>
                <small className="muted">{current ? [current.id, formatCost(current)].filter(Boolean).join(' · ') : model === p.defaultModel ? 'default' : ''}</small>
              </span>
              <span className="ai-model-change">Change</span>
            </button>
            {models && !current && <small className="hint-line">{p.name} doesn't list this model any more. Pick another one.</small>}
          </>
        )}
        {modelsError && <small className="hint-line">{modelsError}</small>}
      </div>

      <div className="field">
        <span>Explanations in</span>
        <Segmented label="Explanations in" value={config.lang} options={LANGS} onChange={(v) => saveAi({ lang: v })} />
        <small>Corrections and examples are always in English.</small>
      </div>

      {ai && (
        <div className="ai-test">
          <button type="button" onClick={() => runTest()} disabled={test?.state === 'busy'}>
            {test?.state === 'busy' ? <span className="spinner" aria-hidden="true" /> : <Icon name="zap" />}
            {test?.state === 'busy' ? 'Testing…' : 'Test the connection'}
          </button>
          {test && test.state !== 'busy' && (
            <p className={'ai-test-result ' + test.state} role={test.state === 'error' ? 'alert' : 'status'}>
              <Icon name={test.state === 'ok' ? 'check' : 'alert'} size={18} /> {test.text}
            </p>
          )}
        </div>
      )}

      <details className="ai-safety">
        <summary>
          <Icon name="lock" size={18} /> How the key is kept safe
        </summary>
        <ul className="small">
          <li>The key stays in this browser on this device. It isn't in the site's code, it isn't sent to GitHub, and it isn't in backups.</li>
          <li>It's only ever sent to {p.name} over HTTPS, when you check a text. The site is not allowed to talk to any other server.</li>
          <li>It's never shown in full here. Removing it here deletes it from this device.</li>
          <li>
            Anyone who can open this site on this device, signed in, could use it. That's why the key should have a small limit:{' '}
            {provider === 'openrouter' ? 'on OpenRouter each key can have its own credit limit.' : 'DeepSeek has no per-key limit, so keep a small balance.'}
          </li>
          <li>Lost the device, or the key leaked? Delete the key on {p.keysPage.replace('https://', '').split('/')[0]} and make a new one.</li>
        </ul>
      </details>

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} label="Remove the key">
        <h2>Remove the key?</h2>
        <p>
          The AI teacher stops working on this device until you paste a key again. {p.name} shows a key only once, so if you don't have a copy, you'll make a new one.
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={removeKey}>
            Remove the key
          </button>
        </div>
      </Sheet>

      <Sheet open={picker} onClose={() => setPicker(false)} label="Choose a model">
        {picker && <ModelPicker models={models} suggested={suggested} value={model} error={modelsError} onPick={pickModel} />}
      </Sheet>
    </div>
  );
}

function KeyNote({ info, provider }: { info: KeyInfo; provider: Provider }) {
  if ('balance' in info) return <small>Balance: {info.balance}.</small>;
  const used = `$${info.used.toFixed(info.used < 1 ? 3 : 2)}`;
  if (info.limit === null) {
    return (
      <small className="hint-line">
        This key has no spending limit, so it could spend your whole balance. Add a limit at{' '}
        <a href={PROVIDERS[provider].keysPage} target="_blank" rel="noopener noreferrer">
          openrouter.ai → Keys
        </a>
        . Used so far: {used}.
      </small>
    );
  }
  return (
    <small>
      Limit ${info.limit.toFixed(2)}, used {used}.
    </small>
  );
}

function ModelPicker({
  models,
  suggested,
  value,
  error,
  onPick,
}: {
  models: ModelInfo[] | null;
  suggested: ModelInfo[];
  value: string;
  error: string;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const found = useMemo(
    () => (query && models ? models.filter((m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)).slice(0, 60) : []),
    [query, models],
  );
  const typedId = /^[\w.-]+\/[\w.:-]+$/.test(q.trim()) && !models?.some((m) => m.id === q.trim());

  return (
    <div className="model-picker">
      <h2>Choose a model</h2>
      <p className="muted small">Prices are for one check of a few sentences. Free models are slower and have tight daily limits.</p>
      <label className="input-icon search">
        <Icon name="search" size={20} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={models ? `Search ${models.length} models` : 'Type a model id, e.g. deepseek/deepseek-chat'}
          aria-label="Search models"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {!models && !error && (
        <p className="status-line">
          <span className="spinner" aria-hidden="true" /> Loading models…
        </p>
      )}
      {error && !models && <p className="hint-line">{error} You can still type a model id.</p>}
      {!query && suggested.length > 0 && (
        <>
          <h3 className="section-title">Good and cheap</h3>
          <ModelList models={suggested} value={value} onPick={onPick} />
        </>
      )}
      {query && <ModelList models={found} value={value} onPick={onPick} />}
      {query && models && !found.length && !typedId && <p className="muted small">No models match “{q.trim()}”.</p>}
      {typedId && (
        <button type="button" className="small" onClick={() => onPick(q.trim())}>
          Use “{q.trim()}”
        </button>
      )}
    </div>
  );
}

function ModelList({ models, value, onPick }: { models: ModelInfo[]; value: string; onPick: (id: string) => void }) {
  return (
    <ul className="model-list">
      {models.map((m) => (
        <li key={m.id}>
          <button type="button" className="model-row" aria-pressed={m.id === value} onClick={() => onPick(m.id)}>
            <span>
              <b>{m.name}</b>
              <small className="muted">{m.id}</small>
            </span>
            <span className="model-cost">{m.id === value ? <Icon name="check" size={20} /> : formatCost(m).replace(' a check', '')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
