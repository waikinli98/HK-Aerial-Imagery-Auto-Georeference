/**
 * Sidebar — My Data.
 *
 * Everything the user has added, in one list: aerial photos and vector layers.
 * Clicking a row expands it in place — aerials get the georeference adjustment
 * panel (move / scale / rotate + the control-point tool), vectors get their
 * symbology controls.
 */
import { useState } from 'react';
import Section from './Section.jsx';
import { DEFAULT_ADJUST, isIdentityAdjust } from '../lib/georef.js';

const NUDGE_STEPS = [0.5, 1, 5, 25];

export default function MyDataSection({
  aerials,
  vectors,
  resolvedCount,
  onUpdateAerial,
  onUpdateAdjust,
  onResetAdjust,
  onRemoveAerial,
  onZoomTo,
  onLookupAerial,
  onPlaceManually,
  onStartGeoref,
  georefActiveId,
  onUpdateVector,
  onVectorStyle,
  onRemoveVector,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const total = aerials.length + vectors.length;
  const toggle = (id) => setExpandedId((cur) => (cur === id ? null : id));

  return (
    <Section
      title="My Data"
      badge={
        total > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              resolvedCount === aerials.length
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {aerials.length ? `${resolvedCount}/${aerials.length} placed` : ''}
            {aerials.length && vectors.length ? ' · ' : ''}
            {vectors.length ? `${vectors.length} vector` : ''}
          </span>
        )
      }
    >
      {total === 0 && (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Nothing yet — add aerial photos or vector layers in “Add Data” above.
          They will all be listed here.
        </p>
      )}

      {(aerials.length > 0 || vectors.length > 0) && (
        <ul className="space-y-1.5">
          {aerials.map((a) => (
            <AerialRow
              key={a.id}
              aerial={a}
              expanded={expandedId === a.id}
              onToggle={() => toggle(a.id)}
              onUpdate={onUpdateAerial}
              onAdjust={onUpdateAdjust}
              onResetAdjust={onResetAdjust}
              onRemove={onRemoveAerial}
              onZoomTo={onZoomTo}
              onLookup={onLookupAerial}
              onPlaceManually={onPlaceManually}
              onStartGeoref={onStartGeoref}
              georefActive={georefActiveId === a.id}
            />
          ))}
          {vectors.map((v) => (
            <VectorRow
              key={v.id}
              vector={v}
              expanded={expandedId === v.id}
              onToggle={() => toggle(v.id)}
              onUpdate={onUpdateVector}
              onStyle={onVectorStyle}
              onRemove={onRemoveVector}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------- aerial row ------------------------------- */

function AerialRow({
  aerial: a,
  expanded,
  onToggle,
  onUpdate,
  onAdjust,
  onResetAdjust,
  onRemove,
  onZoomTo,
  onLookup,
  onPlaceManually,
  onStartGeoref,
  georefActive,
}) {
  const [step, setStep] = useState(5);
  const [code, setCode] = useState(a.photono ?? '');
  const adjust = a.adjust ?? DEFAULT_ADJUST;
  // Functional patch so rapid repeated clicks each build on the latest value.
  const nudge = (dE, dN) =>
    onAdjust(a.id, (cur) => ({ dx: cur.dx + dE * step, dy: cur.dy + dN * step }));

  return (
    <li className="overflow-hidden rounded-md border border-slate-700/70 bg-slate-800/40">
      {/* header row */}
      <div className="flex items-center gap-2 p-2">
        <input
          type="checkbox"
          checked={a.visible}
          onChange={(e) => onUpdate(a.id, { visible: e.target.checked })}
          onClick={(e) => e.stopPropagation()}
          title="Show / hide on map"
          className="accent-sky-500"
        />
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="shrink-0 text-xs" aria-hidden>🖼</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-200" title={a.filename}>
              {a.filename}
            </span>
            <span className="block text-[10px] text-slate-400">
              {a.photono ?? 'no Photo No.'}
              {a.size ? ` · ${a.size[0]}×${a.size[1]} px` : ''}
            </span>
          </span>
          {a.imgError ? (
            <Chip color="rose">✗ Can’t display</Chip>
          ) : a.extent ? (
            <Chip color="emerald">✓ Placed</Chip>
          ) : (
            <Chip color="amber">⏳ Needs bbox</Chip>
          )}
          <span className={`shrink-0 text-[10px] text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
        </button>
      </div>

      {a.imgError && (
        <p className="px-2 pb-2 text-[10px] leading-snug text-rose-300">
          The browser cannot decode this image format (TIFF / JPEG&nbsp;2000 are
          not supported). Re-save the photo as JPEG or PNG and upload it again.
        </p>
      )}

      {/* expanded detail */}
      {expanded && (
        <div className="space-y-3 border-t border-slate-700/60 bg-slate-900/40 p-2.5">
          {a.extent && (
            <p className="font-mono text-[10px] leading-snug text-slate-500">
              [{a.extent.map((v) => v.toFixed(1)).join(', ')}] EPSG:2326
              {a.meta?.year ? ` · flight ${a.meta.year}` : ''}
              {a.meta?.scale ? ` · 1:${a.meta.scale}` : ''}
              {a.source === 'hkms-api' ? ' · via HKMS index' : ''}
            </p>
          )}

          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-[10px] text-slate-400">
              Opacity
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={a.opacity}
                onChange={(e) => onUpdate(a.id, { opacity: Number(e.target.value) })}
                className="flex-1"
              />
            </label>
            {a.extent && (
              <button
                onClick={() => onZoomTo(a.extent)}
                className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-sky-600"
              >
                Zoom
              </button>
            )}
            <button
              onClick={() => onRemove(a.id)}
              className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-rose-600"
            >
              Remove
            </button>
          </div>

          {/* ---- georeferencing method: look up by code, or manual ---- */}
          {!a.extent && !a.imgError && (
            <div className="rounded-md border border-sky-700/50 bg-sky-500/5 p-2.5">
              <h4 className="text-[11px] font-semibold tracking-wide text-slate-300 uppercase">
                Georeference this photo
              </h4>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) onLookup(a.id, code.trim());
                  }}
                  placeholder="Photo No. e.g. E067799C"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                />
                <button
                  onClick={() => code.trim() && onLookup(a.id, code.trim())}
                  className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500"
                >
                  🔎 Look up
                </button>
              </div>
              <button
                onClick={() => onPlaceManually(a.id)}
                className="mt-1.5 w-full rounded-md bg-slate-700 px-3 py-1.5 text-[11px] text-slate-200 transition hover:bg-slate-600"
              >
                🛠 Georeference manually — place at map centre
              </button>
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                Look up fetches the footprint from the HKMS 2.0 index by the
                photo’s code. Manual drops the photo at the current view centre
                so you can move / scale / rotate it into place yourself.
              </p>
            </div>
          )}

          {a.extent && (
            <div className="rounded-md border border-slate-700/70 bg-slate-800/40 p-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-semibold tracking-wide text-slate-300 uppercase">
                  Georeference adjustment
                </h4>
                <div className="flex gap-1.5">
                  {a.photono && (
                    <button
                      onClick={() => onLookup(a.id, a.photono)}
                      title="Re-fetch the footprint from the HKMS 2.0 index (clears manual adjustments)"
                      className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-sky-600"
                    >
                      ↻ Re-look up
                    </button>
                  )}
                  {!isIdentityAdjust(adjust) && (
                    <button
                      onClick={() => onResetAdjust(a.id)}
                      className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-amber-600"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* bounding box preview + content orientation */}
              <label className="mt-2 flex cursor-pointer items-center justify-between text-[10px] text-slate-400">
                Show bounding box on map
                <input
                  type="checkbox"
                  checked={!!a.showBbox}
                  onChange={(e) => onUpdate(a.id, { showBbox: e.target.checked })}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
              </label>
              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
                <span title="Rotate the image content inside the box (for sideways / upside-down scans)">
                  Orientation
                </span>
                <div className="flex flex-1 gap-1">
                  {[0, 90, 180, 270].map((deg) => (
                    <button
                      key={deg}
                      onClick={() => onUpdate(a.id, { orientation: deg })}
                      className={`flex-1 rounded px-1 py-0.5 text-[10px] transition ${
                        (a.orientation ?? 0) === deg
                          ? 'bg-sky-600 font-medium text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              {/* move */}
              <div className="mt-2 flex items-center gap-3">
                <div className="grid grid-cols-3 gap-1" aria-label="Move photo">
                  <span />
                  <NudgeBtn label="↑" title="Move north" onClick={() => nudge(0, 1)} />
                  <span />
                  <NudgeBtn label="←" title="Move west" onClick={() => nudge(-1, 0)} />
                  <NudgeBtn label="↓" title="Move south" onClick={() => nudge(0, -1)} />
                  <NudgeBtn label="→" title="Move east" onClick={() => nudge(1, 0)} />
                </div>
                <div className="flex-1 text-[10px] leading-relaxed text-slate-400">
                  <label className="flex items-center gap-1.5">
                    Step
                    <select
                      value={step}
                      onChange={(e) => setStep(Number(e.target.value))}
                      className="rounded border border-slate-700 bg-slate-950/70 px-1 py-0.5 text-[10px] text-slate-200"
                    >
                      {NUDGE_STEPS.map((s) => (
                        <option key={s} value={s}>{s} m</option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 font-mono text-slate-500">
                    ΔE {adjust.dx.toFixed(1)} m · ΔN {adjust.dy.toFixed(1)} m
                  </p>
                </div>
              </div>

              {/* scale */}
              <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                Scale
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.005"
                  value={adjust.scale}
                  onChange={(e) => onAdjust(a.id, { scale: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-12 text-right font-mono">×{adjust.scale.toFixed(3)}</span>
              </label>

              {/* rotate */}
              <label className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
                Rotate
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="0.1"
                  value={adjust.rotation}
                  onChange={(e) => onAdjust(a.id, { rotation: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-12 text-right font-mono">{adjust.rotation.toFixed(1)}°</span>
              </label>

              {/* control-point georeferencing */}
              <button
                onClick={() => onStartGeoref(a.id)}
                disabled={georefActive}
                className={`mt-2.5 w-full rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                  georefActive
                    ? 'cursor-default bg-emerald-700/40 text-emerald-300'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                {georefActive ? '🎯 Control-point session active…' : '🎯 Georeference with control points'}
              </button>
              {a.georefRms != null && (
                <p className="mt-1 text-[10px] text-emerald-300">
                  Last control-point fit: RMS {a.georefRms.toFixed(2)} m
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------- vector row ------------------------------- */

function VectorRow({ vector: v, expanded, onToggle, onUpdate, onStyle, onRemove }) {
  return (
    <li className="overflow-hidden rounded-md border border-slate-700/70 bg-slate-800/40">
      <div className="flex items-center gap-2 p-2">
        <input
          type="checkbox"
          checked={v.visible}
          onChange={(e) => onUpdate(v.id, { visible: e.target.checked })}
          title="Show / hide on map"
          className="accent-sky-500"
        />
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="shrink-0 text-xs" aria-hidden>🗺</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-200" title={v.name}>
              {v.name}
            </span>
            <span className="block text-[10px] text-slate-400">
              {v.geojson.features?.length ?? '?'} feature(s)
            </span>
          </span>
          <Chip color="sky">{v.dataProjection}</Chip>
          <span className={`shrink-0 text-[10px] text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-slate-700/60 bg-slate-900/40 p-2.5">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
              Fill
              <input
                type="color"
                value={v.style.fillColor}
                onChange={(e) => onStyle(v.id, { fillColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-transparent"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
              Stroke
              <input
                type="color"
                value={v.style.strokeColor}
                onChange={(e) => onStyle(v.id, { strokeColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-transparent"
              />
            </label>
            <button
              onClick={() => onRemove(v.id)}
              className="ml-auto rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-rose-600"
            >
              Remove
            </button>
          </div>
          <label className="flex items-center gap-2 text-[10px] text-slate-400">
            Fill opacity
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={v.style.fillOpacity}
              onChange={(e) => onStyle(v.id, { fillOpacity: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-8 text-right font-mono">{Math.round(v.style.fillOpacity * 100)}%</span>
          </label>
          <label className="flex items-center gap-2 text-[10px] text-slate-400">
            Stroke width
            <input
              type="range"
              min="0.5"
              max="8"
              step="0.5"
              value={v.style.strokeWidth}
              onChange={(e) => onStyle(v.id, { strokeWidth: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-8 text-right font-mono">{v.style.strokeWidth}px</span>
          </label>
        </div>
      )}
    </li>
  );
}

/* --------------------------------- bits ---------------------------------- */

const CHIP_COLORS = {
  emerald: 'bg-emerald-500/20 text-emerald-300',
  amber: 'bg-amber-500/20 text-amber-300',
  rose: 'bg-rose-500/20 text-rose-300',
  sky: 'bg-sky-500/20 text-sky-300',
};

function Chip({ color, children }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP_COLORS[color]}`}>
      {children}
    </span>
  );
}

function NudgeBtn({ label, title, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-7 w-7 rounded bg-slate-700 text-xs text-slate-200 transition hover:bg-sky-600"
    >
      {label}
    </button>
  );
}
