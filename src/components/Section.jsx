/** Shared sidebar section wrapper (collapsible) + inline status message chip. */
import { useState } from 'react';

export default function Section({ title, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left transition hover:bg-slate-800/40"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span
            className={`inline-block text-[10px] text-slate-500 transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          {title}
        </span>
        {badge}
      </button>
      {open && <div className="space-y-3 px-5 pt-0.5 pb-4">{children}</div>}
    </section>
  );
}

const NOTE_STYLES = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function StatusNote({ message }) {
  if (!message) return null;
  return (
    <p className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${NOTE_STYLES[message.kind]}`}>
      {message.text}
    </p>
  );
}
