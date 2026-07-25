/**
 * Sidebar — Add Data.
 *
 * One place for everything that brings data in: aerial photo upload (with the
 * HKMS 2.0 online auto-lookup), vector upload, and — tucked into an
 * "Advanced" fold — the offline resolution paths (catalog file / pasted tag).
 */
import { useRef, useState } from 'react';
import Section, { StatusNote } from './Section.jsx';

export default function AddDataSection({
  autoLookup,
  onAutoLookupChange,
  onImageFiles,
  onCatalogFile,
  onPasteTag,
  onVectorFile,
  catalogInfo,
  matcherMsg,
  vectorMsg,
}) {
  const imageInputRef = useRef(null);
  const catalogInputRef = useRef(null);
  const vectorInputRef = useRef(null);
  const [tagText, setTagText] = useState('');

  return (
    <Section title="Add Data">
      {/* --- aerial photo upload --- */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onImageFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => imageInputRef.current.click()}
        className="w-full rounded-md border border-dashed border-slate-600 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-300 transition hover:border-sky-500 hover:text-sky-300"
      >
        ⬆ Aerial photo(s) — e.g. 2019_E067799C.jpg
      </button>

      {/* --- vector upload --- */}
      <input
        ref={vectorInputRef}
        type="file"
        accept=".zip,.geojson,.json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files[0]) onVectorFile(e.target.files[0]);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => vectorInputRef.current.click()}
        className="w-full rounded-md border border-dashed border-slate-600 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-300 transition hover:border-sky-500 hover:text-sky-300"
      >
        ⬆ Shapefile (.zip) or GeoJSON
      </button>

      {/* --- online auto-lookup --- */}
      <div className="rounded-md border border-sky-700/50 bg-sky-500/5 p-3">
        <label className="flex cursor-pointer items-start justify-between gap-2">
          <span className="text-xs font-medium text-slate-200">
            Auto-resolve bounding box online
            <span className="mt-0.5 block text-[10px] font-normal leading-relaxed text-slate-400">
              On upload, each photo’s footprint is fetched from the HKMS 2.0
              index by its Photo No. Per-photo lookup and manual placement live
              under each image in “My Data”.
            </span>
          </span>
          <input
            type="checkbox"
            checked={autoLookup}
            onChange={(e) => onAutoLookupChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
          />
        </label>
      </div>

      {/* --- advanced / offline georeferencing paths --- */}
      <details className="rounded-md border border-slate-700/70 bg-slate-800/30">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold tracking-wide text-slate-300 uppercase select-none">
          Advanced — offline georeferencing
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              Option A — metadata catalog (JSON/CSV) with columns photono, minx,
              miny, maxx, maxy (EPSG:2326).
            </p>
            <input
              ref={catalogInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files[0]) onCatalogFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => catalogInputRef.current.click()}
              className="mt-1.5 w-full rounded-md bg-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-600"
            >
              Upload catalog file
            </button>
            {catalogInfo && (
              <p className="mt-1.5 text-[10px] text-emerald-300">
                {catalogInfo.filename} — {catalogInfo.count} record(s) loaded
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              Option B — paste the HKMS 2.0 &lt;img&gt; tag (data-minx / … /
              data-photono).
            </p>
            <textarea
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder='<img src="..." data-minx="817480.6" data-miny="831343.6" data-maxx="818209.9" data-maxy="832456.2" data-photono="E067799C">'
              className="mt-1.5 w-full resize-y rounded-md border border-slate-700 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              onClick={() => {
                if (tagText.trim()) onPasteTag(tagText);
              }}
              className="mt-1.5 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500"
            >
              Parse &amp; georeference
            </button>
          </div>
        </div>
      </details>

      <StatusNote message={matcherMsg} />
      <StatusNote message={vectorMsg} />
    </Section>
  );
}
