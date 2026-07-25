/**
 * Sidebar — Compare (split view).
 *
 * Both sides of the swipe divider are independently selectable: any imported
 * (placed) aerial photo, any CEDD ortho year, or the current basemap. Side
 * values are encoded as 'aerial:<id>' | 'ortho:<year>' | 'basemap'.
 */
import Section from './Section.jsx';
import { ORTHO_LAYERS } from '../lib/ortho.js';

function SideSelect({ label, value, onChange, placedAerials }) {
  return (
    <label className="block text-[10px] text-slate-400">
      {label}
      <select
        value={value ?? 'basemap'}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
      >
        <optgroup label="My photos">
          {placedAerials.length === 0 && <option disabled>— none placed yet —</option>}
          {placedAerials.map((a) => (
            <option key={a.id} value={`aerial:${a.id}`}>
              {a.filename}
              {a.photono ? ` — ${a.photono}` : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="CEDD orthophotos">
          {ORTHO_LAYERS.map((o) => (
            <option key={o.id} value={`ortho:${o.id}`}>
              CEDD Ortho — {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Basemap">
          <option value="basemap">Current basemap (latest)</option>
        </optgroup>
      </select>
    </label>
  );
}

export default function CompareSection({ swipe, onSwipeChange, sideSpecs, placedAerials }) {
  return (
    <Section title="Compare — split view">
      <div className="rounded-md border border-slate-700/70 bg-slate-800/30 p-3">
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-xs font-medium text-slate-200">Enable split-screen swipe</span>
          <input
            type="checkbox"
            checked={swipe.enabled}
            onChange={(e) => onSwipeChange({ ...swipe, enabled: e.target.checked })}
            className="h-4 w-4 accent-sky-500"
          />
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Pick what shows on each side of the divider — an imported photo, a
          CEDD ortho year, or the basemap. Drag the on-map handle or use the
          slider.
        </p>

        {swipe.enabled && (
          <div className="mt-2 space-y-2">
            <SideSelect
              label="◀ Left side"
              value={sideSpecs.left}
              onChange={(v) => onSwipeChange({ ...swipe, left: v })}
              placedAerials={placedAerials}
            />
            <SideSelect
              label="Right side ▶"
              value={sideSpecs.right}
              onChange={(v) => onSwipeChange({ ...swipe, right: v })}
              placedAerials={placedAerials}
            />
            <label className="flex items-center gap-2 text-[10px] text-slate-400">
              Position
              <input
                type="range"
                min="0.02"
                max="0.98"
                step="0.01"
                value={swipe.position}
                onChange={(e) => onSwipeChange({ ...swipe, position: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="w-8 text-right font-mono">{Math.round(swipe.position * 100)}%</span>
            </label>
          </div>
        )}
      </div>
    </Section>
  );
}
