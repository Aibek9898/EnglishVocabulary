import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LEVEL_NAMES } from '../lib/types';
import { Icon, type IconName } from './Icon';

/** Lessons and games hide the header and tab bar so nothing competes with the task. */
export function useFocusMode(on = true) {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.classList.add('in-session');
    return () => root.classList.remove('in-session');
  }, [on]);
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Vocab` : 'Vocab';
  }, [title]);
}

/**
 * Runs `fn` when Enter is pressed anywhere except inside a control.
 * Controls handle their own Enter (a focused button clicks, a form submits),
 * so ignoring them stops one key press from firing twice.
 */
export function useEnter(fn: () => void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.repeat || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('button, a, input, textarea, select, summary, dialog')) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- lesson chrome ---------- */

export function SessionHead({
  done,
  total,
  onClose,
  closeLabel = 'End lesson',
  combo = 0,
  label = 'Lesson progress',
}: {
  done: number;
  total: number;
  onClose: () => void;
  closeLabel?: string;
  combo?: number;
  label?: string;
}) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="session-head">
      <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
        <Icon name="x" size={24} />
      </button>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {combo >= 3 && (
        <span className="combo" key={combo} aria-label={`${combo} in a row`}>
          <Icon name="flame" size={16} />
          {combo}
        </span>
      )}
      <span className="session-count">
        {Math.min(done, total)}/{total}
      </span>
    </div>
  );
}

export type Tone = 'correct' | 'almost' | 'hinted' | 'wrong';

/**
 * The fixed bar at the bottom of a lesson: the main button, and the verdict
 * once there is one. The verdict area is a live region, so screen readers
 * announce it.
 */
export function ActionBar({ tone, verdict, children }: { tone?: Tone | null; verdict?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    // The page keeps room for the bar, whatever its height.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => root.style.setProperty('--bar-h', `${bar.offsetHeight}px`)) : null;
    ro?.observe(bar);
    root.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
    // Phones put the keyboard over fixed elements; lift the bar above it.
    const vv = window.visualViewport;
    const lift = () => {
      if (!vv) return;
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      bar.style.transform = hidden > 1 ? `translateY(-${hidden}px)` : '';
    };
    vv?.addEventListener('resize', lift);
    vv?.addEventListener('scroll', lift);
    lift();
    return () => {
      ro?.disconnect();
      vv?.removeEventListener('resize', lift);
      vv?.removeEventListener('scroll', lift);
      root.style.removeProperty('--bar-h');
    };
  }, []);
  return (
    <div ref={ref} className={'action-bar' + (tone ? ` ${tone} has-verdict` : '')}>
      <div className="action-bar-inner">
        <div aria-live="polite" aria-atomic="true">
          {verdict}
        </div>
        <div className="buttons">{children}</div>
      </div>
    </div>
  );
}

const TONE_ICON: Record<Tone, IconName> = { correct: 'check', almost: 'alert', hinted: 'bulb', wrong: 'x' };

export function Verdict({ tone, title, children }: { tone: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`verdict ${tone}`}>
      <span className="verdict-icon">
        <Icon name={TONE_ICON[tone]} size={18} strokeWidth={3} />
      </span>
      <div>
        <div className="verdict-title">{title}</div>
        {children && <div className="verdict-body">{children}</div>}
      </div>
    </div>
  );
}

/** Primary button that takes focus when it appears, so Enter continues. */
export function ContinueButton({ onClick, label = 'Continue', disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <button ref={ref} type="button" className="primary big" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

/** A row of buttons where exactly one is chosen. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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

/* ---------- dialogs and toasts ---------- */

/** Native modal dialog: a bottom sheet on phones, centred on wider screens. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="sheet-body">
          <button type="button" className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={22} />
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}

interface ToastMsg {
  id: number;
  text: string;
  icon?: IconName;
}

const toastListeners = new Set<(t: ToastMsg) => void>();
let toastId = 0;

/** Short confirmation at the bottom of the screen, e.g. "Saved". */
export function toast(text: string, icon: IconName = 'check') {
  const msg = { id: ++toastId, text, icon };
  toastListeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (t: ToastMsg) => {
      setMsg(t);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2600);
    };
    toastListeners.add(show);
    return () => {
      toastListeners.delete(show);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div role="status" aria-live="polite">
      {msg && (
        <div className="toast" key={msg.id}>
          {msg.icon && <Icon name={msg.icon} size={18} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}

/* ---------- progress visuals ---------- */

export function Ring({ value, max, size = 72, stroke = 8, label, children }: { value: number; max: number; size?: number; stroke?: number; label: string; children?: ReactNode }) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const mid = size / 2;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`rg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8f82ff" />
          <stop offset="1" stopColor="#5b4cf0" />
        </linearGradient>
      </defs>
      <circle className="ring-track" cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} />
      <circle
        className="ring-fill"
        cx={mid}
        cy={mid}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${mid} ${mid})`}
        style={{ stroke: pct > 0 ? `url(#rg${id})` : 'transparent' }}
      />
      {children && (
        <text className="ring-label" x="50%" y="50%" dominantBaseline="central" textAnchor="middle" aria-hidden="true">
          {children}
        </text>
      )}
    </svg>
  );
}

/** Five short bars showing the mastery level (0–5). */
export function LevelMeter({ level }: { level: number }) {
  return (
    <span className="meter" role="img" aria-label={`Level ${level} of 5: ${LEVEL_NAMES[level] ?? ''}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= level ? `on l${level}` : undefined} />
      ))}
    </span>
  );
}

/** Counts up to `to` once, quickly; jumps straight there with reduced motion. */
export function useCountUp(to: number, ms = 700) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? to : 0));
  useEffect(() => {
    if (prefersReducedMotion() || to <= 0) {
      setN(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}

const CONFETTI_COLORS = ['#5b4cf0', '#8f82ff', '#ff6a2b', '#f2b705', '#12a06e', '#4cb4f5', '#ff5c8a'];

export function Confetti({ count = 48 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        dx: (Math.random() - 0.5) * 240,
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 350,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}ms`,
              '--dx': `${p.dx}px`,
              '--rot': `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Small empty-state block with an icon. */
export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
