/**
 * Sidebar — One-Key Report.
 *
 * Three tools over the reviewed/placed aerial photos:
 *   a) Image list  — a checkable table (Photo No. / scale / flight height)
 *                    exportable to CSV.
 *   b) API report  — pick a crop area (current map view) + the years to include
 *                    and open a printable interpretation report.
 *   c) Describe changes — pick two photos and get computed differences plus an
 *                    editable observations box.
 */
import { useMemo, useState } from 'react';
import Section from './Section.jsx';
import {
  imageListRows,
  imageListCsv,
  photoYear,
  buildReportHtml,
  changeFacts,
  downloadText,
  openHtmlReport,
} from '../lib/report.js';

const TABS = [
  { key: 'list', label: 'Image list' },
  { key: 'report', label: 'API report' },
  { key: 'changes', label: 'Describe changes' },
];

export default function ReportSection({ placedAerials, viewExtent }) {
  const [tab, setTab] = useState('list');
  return (
    <Section title="One-Key Report" defaultOpen={false}>
      <div className="grid grid-cols-3 gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-1.5 py-1 text-[10px] transition ${
              tab === t.key
                ? 'bg-sky-600 font-medium text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {placedAerials.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Add and place aerial photos first — they will be available here for
          listing and reporting.
        </p>
      ) : tab === 'list' ? (
        <ImageListTool aerials={placedAerials} />
      ) : tab === 'report' ? (
        <ReportTool aerials={placedAerials} viewExtent={viewExtent} />
      ) : (
        <ChangesTool aerials={placedAerials} />
      )}
    </Section>
  );
}

/* ------------------------------ a) image list ----------------------------- */

function ImageListTool({ aerials }) {
  const [checked, setChecked] = useState(() => new Set(aerials.map((a) => a.id)));
  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selected = aerials.filter((a) => checked.has(a.id));
  const rows = imageListRows(selected);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>{checked.size} of {aerials.length} selected</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => setChecked(new Set(aerials.map((a) => a.id)))}
            className="rounded bg-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-600"
          >
            All
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="rounded bg-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-600"
          >
            None
          </button>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto rounded-md border border-slate-700/60">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-slate-800 text-slate-300">
            <tr>
              <th className="w-6 px-1 py-1"></th>
              <th className="px-2 py-1 text-left">Image No. / ID</th>
              <th className="px-2 py-1 text-left">Scale</th>
              <th className="px-2 py-1 text-left">Flight ht.</th>
            </tr>
          </thead>
          <tbody>
            {aerials.map((a) => {
              const r = imageListRows([a])[0];
              return (
                <tr key={a.id} className="border-t border-slate-800">
                  <td className="px-1 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={checked.has(a.id)}
                      onChange={() => toggle(a.id)}
                      className="accent-sky-500"
                    />
                  </td>
                  <td className="px-2 py-1 font-mono text-slate-200">{r.id}</td>
                  <td className="px-2 py-1 text-slate-300">{r.scale}</td>
                  <td className="px-2 py-1 text-slate-300">{r.flyingHt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-1.5">
        <button
          disabled={!selected.length}
          onClick={() => downloadText('aerial-image-list.csv', imageListCsv(selected), 'text/csv')}
          className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
        <button
          disabled={!selected.length}
          onClick={() => navigator.clipboard?.writeText(imageListCsv(selected))}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-[11px] text-slate-200 transition hover:bg-slate-600 disabled:opacity-40"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ b) API report ----------------------------- */

function ReportTool({ aerials, viewExtent }) {
  const years = useMemo(() => {
    const set = new Set();
    for (const a of aerials) {
      const y = photoYear(a);
      if (y) set.add(y);
    }
    return [...set].sort((a, b) => a - b);
  }, [aerials]);

  const [checkedYears, setCheckedYears] = useState(() => new Set(years));
  const [useCrop, setUseCrop] = useState(false);
  const [title, setTitle] = useState('Aerial Photo Interpretation Report');
  const [location, setLocation] = useState('');
  const [preparedBy, setPreparedBy] = useState('');

  const toggleYear = (y) =>
    setCheckedYears((prev) => {
      const next = new Set(prev);
      next.has(y) ? next.delete(y) : next.add(y);
      return next;
    });

  const inCrop = (a) => {
    if (!useCrop || !viewExtent || !a.extent) return true;
    // keep photos whose footprint intersects the crop (current view) extent
    return !(
      a.extent[2] < viewExtent[0] ||
      a.extent[0] > viewExtent[2] ||
      a.extent[3] < viewExtent[1] ||
      a.extent[1] > viewExtent[3]
    );
  };

  const generate = () => {
    const groups = years
      .filter((y) => checkedYears.has(y))
      .map((y) => ({
        year: y,
        photos: aerials.filter((a) => photoYear(a) === y && inCrop(a)),
      }))
      .filter((g) => g.photos.length);
    const html = buildReportHtml({
      title,
      location,
      area: useCrop ? viewExtent : null,
      groups,
      preparedBy,
    });
    openHtmlReport(html);
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Report title"
        className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
      />
      <input
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Location / site (e.g. Tan Kwai Tsuen)"
        className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
      />
      <input
        type="text"
        value={preparedBy}
        onChange={(e) => setPreparedBy(e.target.value)}
        placeholder="Prepared by"
        className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
      />

      <label className="flex cursor-pointer items-center justify-between text-[10px] text-slate-300">
        Crop to current map view
        <input
          type="checkbox"
          checked={useCrop}
          onChange={(e) => setUseCrop(e.target.checked)}
          className="h-3.5 w-3.5 accent-sky-500"
        />
      </label>
      {useCrop && (
        <p className="text-[10px] text-slate-500">
          Only photos intersecting the current view are included. Pan/zoom the
          map to set the crop area.
        </p>
      )}

      <div>
        <p className="mb-1 text-[10px] text-slate-400">Years to include</p>
        <div className="flex flex-wrap gap-1">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => toggleYear(y)}
              className={`rounded px-2 py-0.5 text-[10px] transition ${
                checkedYears.has(y)
                  ? 'bg-sky-600 font-medium text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={!checkedYears.size}
        onClick={generate}
        className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
      >
        📄 Generate report (print / PDF)
      </button>
      <p className="text-[10px] leading-relaxed text-slate-500">
        Opens a printable report grouped by year with each photo’s metadata and
        an observations line. Structure follows a standard SMO interpretation
        report — share your template and I can match it exactly.
      </p>
    </div>
  );
}

/* --------------------------- c) describe changes -------------------------- */

function ChangesTool({ aerials }) {
  const opts = aerials;
  const [aId, setAId] = useState(opts[0]?.id ?? '');
  const [bId, setBId] = useState(opts[1]?.id ?? opts[0]?.id ?? '');
  const [notes, setNotes] = useState('');

  const a = opts.find((x) => x.id === aId);
  const b = opts.find((x) => x.id === bId);
  const facts = a && b ? changeFacts(a, b) : null;

  const label = (x) => `${x.photono || x.filename}${photoYear(x) ? ` (${photoYear(x)})` : ''}`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10px] text-slate-400">
          Photo A (earlier)
          <select
            value={aId}
            onChange={(e) => setAId(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-950/70 px-1 py-1 text-[10px] text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {opts.map((o) => (
              <option key={o.id} value={o.id}>{label(o)}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-slate-400">
          Photo B (later)
          <select
            value={bId}
            onChange={(e) => setBId(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-950/70 px-1 py-1 text-[10px] text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {opts.map((o) => (
              <option key={o.id} value={o.id}>{label(o)}</option>
            ))}
          </select>
        </label>
      </div>

      {facts && (
        <div className="rounded-md border border-slate-700/60 bg-slate-950/40 p-2 text-[10px] leading-relaxed text-slate-300">
          <p><b>{facts.a.id}</b> {facts.a.year ?? '—'} vs <b>{facts.b.id}</b> {facts.b.year ?? '—'}</p>
          {facts.yearGap != null && <p>Time span: {facts.yearGap} year(s)</p>}
          {facts.overlapPct != null && (
            <p>
              Footprint overlap: {facts.overlapPct}% —{' '}
              {facts.sameArea ? 'same area (good comparison)' : 'largely different areas'}
            </p>
          )}
          <p className="mt-1 text-slate-500">
            Tip: use Compare (swipe) or Timelapse to inspect visually, then note
            what changed below.
          </p>
        </div>
      )}

      <textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Observed changes — new buildings, road works, reclamation, vegetation loss, slope failures…"
        className="w-full resize-y rounded-md border border-slate-700 bg-slate-950/70 p-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
      />
      <button
        disabled={!a || !b}
        onClick={() => {
          const text =
            `Change description: ${facts.a.id} (${facts.a.year ?? '—'}) → ${facts.b.id} (${facts.b.year ?? '—'})\n` +
            `Time span: ${facts.yearGap ?? '—'} year(s)\n` +
            `Footprint overlap: ${facts.overlapPct ?? '—'}%\n\n` +
            `Observations:\n${notes || '(none)'}\n`;
          downloadText(`change-${facts.a.id}-${facts.b.id}.txt`, text);
        }}
        className="w-full rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
      >
        ⬇ Export change note
      </button>
      <p className="text-[10px] leading-relaxed text-slate-500">
        Computed facts come from the index; the visual interpretation is yours
        (browser-side automatic change detection isn’t reliable on tilted
        historical photos).
      </p>
    </div>
  );
}
