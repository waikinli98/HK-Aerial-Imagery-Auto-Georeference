/**
 * Sidebar — Basemap.
 *
 * Clearly separated from user data: the base cartography (LandsD topo /
 * imagery / OSM) plus the CEDD historical ortho overlay. While the split-view
 * compare is active the two compare sides define what is shown, so the ortho
 * overlay control is disabled to avoid two things fighting over the map.
 */
import { useState } from 'react';
import Section, { StatusNote } from './Section.jsx';
import { ORTHO_LAYERS } from '../lib/ortho.js';
import { FLIGHT_YEARS } from '../lib/flightpaths.js';

export const BASEMAPS = [
  { key: 'landsd-topo', label: 'LandsD Topographic' },
  { key: 'landsd-imagery', label: 'LandsD Imagery' },
  { key: 'osm', label: 'OpenStreetMap' },
];

export default function BasemapSection({
  basemapKey,
  onBasemapChange,
  orthoYear,
  onOrthoYearChange,
  compareActive,
  slopes,
  onSlopesToggle,
  onSlopeSearch,
  onSlopesStyle,
  slopesMsg,
  flightPaths,
  onFlightPathsChange,
}) {
  const st = slopes.style ?? {};
  const [searchText, setSearchText] = useState('');
  // Structured slope-number builder (mirrors the HKMS "Textual Search" UI):
  // {sheet}{quadrant-section}-/{type} {number} → e.g. 6NW-C/C 340
  const [sheet, setSheet] = useState('1');
  const [quadLetter, setQuadLetter] = useState('NW-A');
  const [slopeType, setSlopeType] = useState('C');
  const [slopeNum, setSlopeNum] = useState('');
  const structuredQuery = () => {
    const [quad, letter] = quadLetter.split('-');
    return `${sheet}${quad}-${letter}/${slopeType} ${slopeNum.trim()}`;
  };
  return (
    <Section title="Basemap">
      <div className="grid grid-cols-3 gap-1.5">
        {BASEMAPS.map((b) => (
          <button
            key={b.key}
            onClick={() => onBasemapChange(b.key)}
            className={`rounded-md px-2 py-1.5 text-[11px] transition ${
              basemapKey === b.key
                ? 'bg-sky-600 font-medium text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-300 uppercase">
          Ortho photo overlay (CEDD)
        </p>
        <select
          value={orthoYear}
          onChange={(e) => onOrthoYearChange(e.target.value)}
          disabled={compareActive}
          className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-40"
        >
          <option value="">None — basemap only</option>
          {ORTHO_LAYERS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {compareActive
            ? 'Disabled while Compare is on — pick ortho years on the compare sides instead.'
            : 'Government orthophotos (1963–2022) drawn above the basemap and below your photos. Served via CEDD’s public map proxy.'}
        </p>
      </div>

      {/* Reference feature layers */}
      <div className="rounded-md border border-slate-700/70 bg-slate-800/30 p-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate-300 uppercase">
          Reference features
        </p>

        {/* structured slope-number search (sheet / quadrant-section / type / no.) */}
        <label className="mt-2 block text-[10px] text-slate-400">
          Feature to be displayed
          <div className="mt-1 flex gap-1">
            <select
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              title="Map sheet"
              className="w-12 rounded-md border border-slate-700 bg-slate-950/70 px-1 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {Array.from({ length: 16 }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <select
              value={quadLetter}
              onChange={(e) => setQuadLetter(e.target.value)}
              title="Quadrant – section"
              className="w-[4.5rem] rounded-md border border-slate-700 bg-slate-950/70 px-1 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {['NW', 'NE', 'SW', 'SE'].flatMap((q) =>
                ['A', 'B', 'C', 'D'].map((l) => (
                  <option key={`${q}-${l}`} value={`${q}-${l}`}>{`${q}-${l}`}</option>
                ))
              )}
            </select>
            <select
              value={slopeType}
              onChange={(e) => setSlopeType(e.target.value)}
              title="Feature type (C cut, F fill, R retaining wall…)"
              className="w-14 rounded-md border border-slate-700 bg-slate-950/70 px-1 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              {['C', 'CR', 'F', 'FR', 'R'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="numeric"
              value={slopeNum}
              onChange={(e) => setSlopeNum(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && slopeNum.trim()) onSlopeSearch(structuredQuery());
              }}
              placeholder="No."
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={() => slopeNum.trim() && onSlopeSearch(structuredQuery())}
              disabled={!slopeNum.trim()}
              title="Search by slope number"
              className="shrink-0 rounded-md bg-sky-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              🔍
            </button>
          </div>
        </label>

        {/* free-text fallback */}
        <label className="mt-1.5 block text-[10px] text-slate-400">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSlopeSearch(searchText);
              }}
              placeholder="Slope registration no. — e.g. 6NW-C/C 340"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={() => onSlopeSearch(searchText)}
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500"
            >
              Search
            </button>
          </div>
        </label>

        <label className="mt-2 flex cursor-pointer items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-slate-200">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-red-500" aria-hidden />
            CEDD Man-made Slopes
          </span>
          <input
            type="checkbox"
            checked={slopes.enabled}
            onChange={(e) => onSlopesToggle(e.target.checked)}
            className="h-4 w-4 accent-red-500"
          />
        </label>

        {slopes.enabled && (
          <div className="mt-2 space-y-1.5 rounded-md border border-slate-700/60 bg-slate-950/40 p-2">
            <label className="flex cursor-pointer items-center justify-between text-[10px] text-slate-300">
              Show slope number labels
              <input
                type="checkbox"
                checked={!!slopes.showLabels}
                onChange={(e) => onSlopesStyle({ showLabels: e.target.checked })}
                className="h-3.5 w-3.5 accent-red-500"
              />
            </label>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="w-14">Outline</span>
              <input
                type="color"
                value={st.strokeColor ?? '#ef4444'}
                onChange={(e) => onSlopesStyle({ strokeColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-transparent"
                title="Outline colour"
              />
              <select
                value={st.strokeStyle ?? 'solid'}
                onChange={(e) => onSlopesStyle({ strokeStyle: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950/70 px-1 py-0.5 text-[10px] text-slate-200"
                title="Outline style"
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
              <input
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={st.strokeWidth ?? 2}
                onChange={(e) => onSlopesStyle({ strokeWidth: Number(e.target.value) })}
                className="flex-1"
                title="Outline width"
              />
              <span className="w-8 text-right font-mono">{(st.strokeWidth ?? 2)}px</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="w-14">Fill</span>
              <input
                type="color"
                value={st.fillColor ?? '#ef4444'}
                onChange={(e) => onSlopesStyle({ fillColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-slate-700 bg-transparent"
                title="Fill colour"
              />
              <span className="text-slate-500">opacity</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={st.fillOpacity ?? 0}
                onChange={(e) => onSlopesStyle({ fillOpacity: Number(e.target.value) })}
                className="flex-1"
                title="Fill opacity (0 = hollow)"
              />
              <span className="w-8 text-right font-mono">{Math.round((st.fillOpacity ?? 0) * 100)}%</span>
            </div>
          </div>
        )}

        <StatusNote message={slopesMsg} />
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Registered man-made slopes © CEDD via CSDI. Features load for the
          current view from about 1:20&nbsp;000 — zoom in if nothing appears.
          {slopes.filter ? ` Showing only matches for “${slopes.filter}”.` : ''}
        </p>

        {/* HKMS flight paths + photo centres */}
        <div className="mt-3 border-t border-slate-700/60 pt-3">
          <label className="flex cursor-pointer items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-200">
              <span className="inline-block h-2 w-2 rounded-full bg-orange-400" aria-hidden />
              HKMS flight paths &amp; photo centres
            </span>
            <input
              type="checkbox"
              checked={flightPaths.enabled}
              onChange={(e) => onFlightPathsChange({ ...flightPaths, enabled: e.target.checked })}
              className="h-4 w-4 accent-orange-400"
            />
          </label>
          {flightPaths.enabled && (
            <label className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
              Flight year
              <select
                value={flightPaths.year}
                onChange={(e) => onFlightPathsChange({ ...flightPaths, year: Number(e.target.value) })}
                className="flex-1 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {FLIGHT_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Blue flight routes with a dot per vertical photo (HKMS 2.0 index).
            Click a dot to reveal that photo’s bounding box and details — zoom
            in to about 1:40&nbsp;000 to load the dots.
          </p>
        </div>
      </div>
    </Section>
  );
}
