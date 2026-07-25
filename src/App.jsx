/**
 * HKMS Aerial Photo Georeferencer — application shell.
 *
 * Owns all application state (aerial photos, metadata catalog, vector layers,
 * view options, the split-view compare, and the control-point georeferencing
 * session) and wires the left sidebar controls to the OpenLayers map.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import shp from 'shpjs';
import MapView from './components/MapView.jsx';
import AddDataSection from './components/AddDataSection.jsx';
import MyDataSection from './components/MyDataSection.jsx';
import BasemapSection from './components/BasemapSection.jsx';
import CompareSection from './components/CompareSection.jsx';
import TimelapseSection from './components/TimelapseSection.jsx';
import ReportSection from './components/ReportSection.jsx';
import { extractPhotoNo, parseHkmsImgTag, parseCatalog } from './lib/parse.js';
import { lookupPhotoExtent } from './lib/hkms.js';
import { nearestOrthoYear } from './lib/ortho.js';
import { searchSlopes, DEFAULT_SLOPES_STYLE } from './lib/slopes.js';
import { photoYear } from './lib/report.js';
import { DEFAULT_ADJUST, solveHelmert, composeAdjust, autoFit } from './lib/georef.js';

let nextId = 1;
const uid = (prefix) => `${prefix}-${nextId++}`;

/** Default symbology assigned to newly imported vector layers. */
const DEFAULT_VECTOR_STYLE = {
  fillColor: '#0ea5e9',
  fillOpacity: 0.25,
  strokeColor: '#0369a1',
  strokeWidth: 2,
};

export default function App() {
  // ---- data ---------------------------------------------------------------
  // aerial: { id, filename, photono, url, extent|null, adjust, source, meta,
  //           visible, opacity, imgError, size, georefRms }
  const [aerials, setAerials] = useState([]);
  const [catalog, setCatalog] = useState(() => new Map());
  const [catalogInfo, setCatalogInfo] = useState(null);
  const [matcherMsg, setMatcherMsg] = useState(null); // { kind, text }
  const [autoLookup, setAutoLookup] = useState(true);

  // vector: { id, name, geojson, dataProjection, visible, style }
  const [vectors, setVectors] = useState([]);
  const [vectorMsg, setVectorMsg] = useState(null);

  // ---- view ---------------------------------------------------------------
  const [basemapKey, setBasemapKey] = useState('landsd-topo');
  const [orthoYear, setOrthoYear] = useState(''); // '' = off (see lib/ortho.js)

  // Split view: each side is 'aerial:<id>' | 'ortho:<year>' | 'basemap'.
  const [swipe, setSwipe] = useState({ enabled: false, position: 0.5, left: '', right: 'basemap' });

  // CEDD man-made slopes reference layer; filter = "Feature to be displayed".
  const [slopes, setSlopes] = useState({
    enabled: false,
    filter: '',
    showLabels: false,
    style: { ...DEFAULT_SLOPES_STYLE },
  });
  const [slopesMsg, setSlopesMsg] = useState(null);

  // HKMS flight paths: photo-centre points + routes for one year; clicking a
  // point on the map reveals that photo's footprint (like the HKMS viewer).
  const [flightPaths, setFlightPaths] = useState({ enabled: false, year: 2021 });

  // Timelapse player over the placed photos (chronological fly-through).
  const [timelapse, setTimelapse] = useState({
    enabled: false,
    mode: 'perImage', // 'perImage' | 'total'
    perImageSec: 1.5,
    totalSec: 10,
    loop: true,
    playing: false,
    index: 0,
  });

  // Current map view extent (EPSG:2326) for the report crop tool.
  const [viewExtent, setViewExtent] = useState(null);

  // Control-point georeferencing session (null = inactive).
  // { aerialId, pairs: [{src:[E,N], dst:[E,N]}], draft: [E,N]|null }
  const [georef, setGeoref] = useState(null);

  // Current map view centre in EPSG:2326 (updated by MapView on moveend) —
  // used to seed manual placement of photos that have no bounding box.
  const viewCenterRef = useRef([835000, 818000]);

  const [zoomRequest, setZoomRequest] = useState(null);
  const requestZoom = useCallback((extent) => {
    setZoomRequest({ extent, epoch: Date.now() });
  }, []);

  // ------------------------------------------------------------------------
  // Aerial image upload — extract Photo No., resolve bbox from the local
  // catalog, then fall back to the HKMS 2.0 online index.
  // ------------------------------------------------------------------------
  const handleImageFiles = useCallback(
    (files) => {
      const added = [];
      for (const file of files) {
        const photono = extractPhotoNo(file.name);
        const extent = photono ? catalog.get(photono) ?? null : null;
        added.push({
          id: uid('img'),
          filename: file.name,
          photono,
          url: URL.createObjectURL(file),
          extent,
          adjust: { ...DEFAULT_ADJUST },
          source: extent ? 'catalog' : null,
          meta: null,
          visible: true,
          opacity: 1,
          imgError: false,
          size: null, // [width, height] px, filled in by the decode probe
          georefRms: null,
          orientation: 0, // 0/90/180/270° CCW — content rotation within the box
          showBbox: false, // draw the bounding-box outline on the map
          autoFitted: false, // auto-orientation not applied yet
        });
      }
      setAerials((prev) => [...prev, ...added]);

      // Preflight-decode every file so undisplayable formats (TIFF, JPEG 2000…)
      // are flagged instead of silently rendering nothing.
      for (const a of added) {
        const probe = new Image();
        probe.onload = () =>
          setAerials((prev) =>
            prev.map((p) =>
              p.id === a.id ? { ...p, size: [probe.naturalWidth, probe.naturalHeight] } : p
            )
          );
        probe.onerror = () =>
          setAerials((prev) => prev.map((p) => (p.id === a.id ? { ...p, imgError: true } : p)));
        probe.src = a.url;
      }

      const resolved = added.find((a) => a.extent);
      const pending = added.filter((a) => !a.extent && a.photono);
      if (autoLookup && pending.length) {
        setMatcherMsg({
          kind: 'info',
          text: `Looking up ${pending.length} photo(s) online from the HKMS 2.0 index…`,
        });
        (async () => {
          const found = [];
          const missing = [];
          await Promise.all(
            pending.map(async (a) => {
              try {
                const hit = await lookupPhotoExtent(a.photono);
                if (hit) found.push({ id: a.id, photono: a.photono, ...hit });
                else missing.push(a.photono);
              } catch {
                missing.push(a.photono);
              }
            })
          );
          if (found.length) {
            setAerials((prev) =>
              prev.map((a) => {
                const hit = found.find((f) => f.id === a.id);
                if (!hit) return a;
                // Orientation is applied by the auto-fit effect below, once
                // both the bbox and the decoded image size are known.
                return {
                  ...a,
                  extent: hit.extent,
                  source: 'hkms-api',
                  meta: hit.meta,
                  autoFitted: false,
                };
              })
            );
            setCatalog((prev) => {
              const next = new Map(prev);
              found.forEach((f) => next.set(f.photono, f.extent));
              return next;
            });
          }
          setMatcherMsg({
            kind: missing.length ? 'warn' : 'ok',
            text: `Online lookup: ${found.length} placed${
              missing.length
                ? `, ${missing.length} not found (${missing.join(', ')}) — try the offline options.`
                : ' from the HKMS 2.0 index.'
            }`,
          });
        })();
      } else if (pending.length) {
        setMatcherMsg({
          kind: 'warn',
          text: `${pending.length} of ${added.length} photo(s) need a bounding box — enable auto-lookup or use the offline options.`,
        });
      } else if (resolved) {
        setMatcherMsg({ kind: 'ok', text: `${added.length} photo(s) georeferenced from the catalog.` });
      }
    },
    [catalog, autoLookup]
  );

  // ------------------------------------------------------------------------
  // Per-photo online lookup ("Look up code" under each image). Re-running it
  // on a placed photo re-fetches the box and clears any manual adjustment.
  // ------------------------------------------------------------------------
  const handleLookupAerial = useCallback(async (id, rawCode) => {
    const raw = String(rawCode ?? '').toUpperCase().trim();
    // Accept whatever the user typed if it plausibly IS a photo number
    // (old serials like "73576" carry no letter prefix).
    const photono =
      extractPhotoNo(raw) || (/^[A-Z]{0,2}\d{3,7}[A-Z]?$/.test(raw) ? raw : null);
    if (!photono) {
      setMatcherMsg({ kind: 'error', text: 'Enter a Photo No. such as E067799C or 73576.' });
      return;
    }
    setMatcherMsg({ kind: 'info', text: `Looking up ${photono} online…` });
    let hit;
    try {
      hit = await lookupPhotoExtent(photono);
    } catch (err) {
      setMatcherMsg({ kind: 'error', text: `HKMS lookup unavailable: ${err.message}` });
      return;
    }
    if (!hit) {
      setMatcherMsg({
        kind: 'warn',
        text: `${photono} was not found in the HKMS 2.0 index — try manual placement instead.`,
      });
      return;
    }
    setCatalog((prev) => new Map(prev).set(photono, hit.extent));
    setAerials((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              photono,
              extent: hit.extent,
              source: 'hkms-api',
              meta: hit.meta,
              adjust: { ...DEFAULT_ADJUST },
              orientation: 0,
              autoFitted: false, // the auto-fit effect re-orients it
              georefRms: null,
            }
          : a
      )
    );
    setMatcherMsg({
      kind: 'ok',
      text: `Georeferenced from the HKMS 2.0 index (${photono}${
        hit.meta.year ? `, flight ${hit.meta.year}` : ''
      }${hit.meta.angle != null ? `, flight azimuth ${Math.round(hit.meta.angle)}°` : ''}).`,
    });
    requestZoom(hit.extent);
  }, [requestZoom]);

  // ------------------------------------------------------------------------
  // Manual placement: drop an un-referenced photo at the current view centre
  // so it can be positioned by hand (nudge/scale/rotate or control points).
  // ------------------------------------------------------------------------
  const handlePlaceManually = useCallback((id) => {
    const [cx, cy] = viewCenterRef.current;
    setAerials((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const aspect = a.size ? a.size[1] / a.size[0] : 0.75;
        const w = 800; // metres — a typical HKMS footprint width
        const h = w * aspect;
        return {
          ...a,
          extent: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
          source: 'manual',
          adjust: { ...DEFAULT_ADJUST },
          georefRms: null,
          autoFitted: true, // manual placement — never auto-rotate it
        };
      })
    );
    setMatcherMsg({
      kind: 'ok',
      text: 'Photo placed at the view centre — refine it with move/scale/rotate or control points.',
    });
  }, []);

  // ------------------------------------------------------------------------
  // Option A — metadata catalog upload (JSON/CSV lookup table).
  // ------------------------------------------------------------------------
  const handleCatalogFile = useCallback(
    async (file) => {
      try {
        const lookup = parseCatalog(await file.text(), file.name);
        setCatalog((prev) => new Map([...prev, ...lookup]));
        setCatalogInfo({ filename: file.name, count: lookup.size });
        const matched = aerials.filter((a) => !a.extent && a.photono && lookup.has(a.photono));
        setAerials((prev) =>
          prev.map((a) =>
            a.extent || !a.photono || !lookup.has(a.photono)
              ? a
              : { ...a, extent: lookup.get(a.photono), source: 'catalog' }
          )
        );
        setMatcherMsg({
          kind: 'ok',
          text: `Catalog loaded: ${lookup.size} record(s)${
            matched.length ? `, ${matched.length} pending photo(s) resolved` : ''
          }.`,
        });
      } catch (err) {
        setMatcherMsg({ kind: 'error', text: `Catalog parse failed: ${err.message}` });
      }
    },
    [aerials]
  );

  // ------------------------------------------------------------------------
  // Option B — paste the HKMS 2.0 <img ...> tag.
  // ------------------------------------------------------------------------
  const handlePasteTag = useCallback(
    (html) => {
      const parsed = parseHkmsImgTag(html);
      if (parsed.error) {
        setMatcherMsg({ kind: 'error', text: parsed.error });
        return;
      }
      const { photono, extent } = parsed;
      if (photono) {
        setCatalog((prev) => new Map(prev).set(photono, extent));
      }
      const byPhotoNo = photono && aerials.find((a) => a.photono === photono);
      const target = byPhotoNo || aerials.find((a) => !a.extent);
      if (target) {
        setAerials((prev) =>
          prev.map((a) => (a.id === target.id ? { ...a, extent, source: 'paste' } : a))
        );
        setMatcherMsg({
          kind: 'ok',
          text: `Bounding box applied to ${target.filename}${
            byPhotoNo ? ` (matched by Photo No. ${photono})` : ' (first unresolved photo)'
          }.`,
        });
      } else {
        setMatcherMsg({
          kind: photono ? 'warn' : 'error',
          text: photono
            ? `Parsed ${photono} and stored it in the catalog — upload the matching image file to place it.`
            : 'Tag parsed, but there is no uploaded photo left to attach it to.',
        });
      }
    },
    [aerials]
  );

  // ------------------------------------------------------------------------
  // Aerial layer housekeeping.
  // ------------------------------------------------------------------------
  const updateAerial = useCallback((id, patch) => {
    setAerials((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  // `patch` may be an object or a function of the current adjust — the
  // functional form keeps rapid repeated nudges from reading stale state.
  const updateAdjust = useCallback((id, patch) => {
    setAerials((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const cur = a.adjust ?? DEFAULT_ADJUST;
        const p = typeof patch === 'function' ? patch(cur) : patch;
        return { ...a, adjust: { ...cur, ...p } };
      })
    );
  }, []);

  const resetAdjust = useCallback((id) => {
    setAerials((prev) =>
      prev.map((a) => (a.id === id ? { ...a, adjust: { ...DEFAULT_ADJUST }, georefRms: null } : a))
    );
  }, []);

  const removeAerial = useCallback((id) => {
    setGeoref((g) => (g && g.aerialId === id ? null : g));
    setAerials((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ------------------------------------------------------------------------
  // Vector import + housekeeping.
  // ------------------------------------------------------------------------
  const handleVectorFile = useCallback(async (file) => {
    try {
      let collections;
      if (/\.zip$/i.test(file.name)) {
        const parsed = await shp(await file.arrayBuffer());
        collections = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        collections = [JSON.parse(await file.text())];
      }
      const layers = collections.map((geojson, i) => {
        const sample = firstCoordinate(geojson);
        const isProjected = sample && (Math.abs(sample[0]) > 360 || Math.abs(sample[1]) > 360);
        return {
          id: uid('vec'),
          name:
            geojson.fileName ||
            (collections.length > 1 ? `${file.name} (${i + 1})` : file.name),
          geojson,
          dataProjection: isProjected ? 'EPSG:2326' : 'EPSG:4326',
          visible: true,
          style: { ...DEFAULT_VECTOR_STYLE },
        };
      });
      setVectors((prev) => [...prev, ...layers]);
      const total = layers.reduce((n, l) => n + (l.geojson.features?.length ?? 0), 0);
      setVectorMsg({ kind: 'ok', text: `Imported ${layers.length} layer(s), ${total} feature(s).` });
    } catch (err) {
      setVectorMsg({ kind: 'error', text: `Import failed: ${err.message}` });
    }
  }, []);

  const updateVector = useCallback((id, patch) => {
    setVectors((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const updateVectorStyle = useCallback((id, stylePatch) => {
    setVectors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, style: { ...v.style, ...stylePatch } } : v))
    );
  }, []);

  const removeVector = useCallback((id) => {
    setVectors((prev) => prev.filter((v) => v.id !== id));
  }, []);

  // ------------------------------------------------------------------------
  // Control-point georeferencing session.
  // ------------------------------------------------------------------------
  const startGeoref = useCallback(
    (aerialId) => {
      const aerial = aerials.find((a) => a.id === aerialId);
      if (!aerial?.extent) return;
      // Best reference = the ortho year closest to the photo's flight year.
      const year = nearestOrthoYear(aerial.meta?.year);
      if (year) setOrthoYear(year);
      setSwipe((s) => ({ ...s, enabled: false })); // swipe and CP picking clash
      setGeoref({ aerialId, pairs: [], draft: null });
      requestZoom(aerial.extent);
    },
    [aerials, requestZoom]
  );

  const georefClick = useCallback((coord2326) => {
    setGeoref((g) => {
      if (!g) return g;
      if (!g.draft) return { ...g, draft: coord2326 };
      return { ...g, pairs: [...g.pairs, { src: g.draft, dst: coord2326 }], draft: null };
    });
  }, []);

  const georefUndo = useCallback(() => {
    setGeoref((g) => {
      if (!g) return g;
      if (g.draft) return { ...g, draft: null };
      return { ...g, pairs: g.pairs.slice(0, -1) };
    });
  }, []);

  const georefClear = useCallback(() => {
    setGeoref((g) => (g ? { ...g, pairs: [], draft: null } : g));
  }, []);

  const georefCancel = useCallback(() => setGeoref(null), []);

  const georefApply = useCallback(() => {
    setGeoref((g) => {
      if (!g || g.pairs.length < 3) return g;
      const fit = solveHelmert(g.pairs);
      if (!fit) return g;
      setAerials((prev) =>
        prev.map((a) =>
          a.id === g.aerialId
            ? {
                ...a,
                adjust: composeAdjust(a.adjust ?? DEFAULT_ADJUST, fit, a.extent),
                georefRms: fit.rms,
                source: a.source,
              }
            : a
        )
      );
      return null; // end the session
    });
  }, []);

  // ------------------------------------------------------------------------
  // Auto-orientation: once a photo has BOTH a bounding box and a decoded size,
  // derive its content orientation from the flight azimuth + aspect ratio
  // (old flight-up film scans vs modern north-up products). Runs once per
  // placement (autoFitted flag), so later manual tweaks are never overridden.
  // ------------------------------------------------------------------------
  useEffect(() => {
    const pending = aerials.filter(
      (a) => a.extent && a.size && a.autoFitted === false && a.source === 'hkms-api'
    );
    if (!pending.length) return;
    setAerials((prev) =>
      prev.map((a) => {
        if (!pending.some((p) => p.id === a.id)) return a;
        const fit = autoFit(a.meta?.angle ?? null, a.size, a.extent);
        return {
          ...a,
          autoFitted: true,
          orientation: fit ? fit.orientation : 0,
          adjust: fit
            ? { ...DEFAULT_ADJUST, rotation: fit.rotation, scale: fit.scale }
            : { ...DEFAULT_ADJUST },
        };
      })
    );
  }, [aerials]);

  // ------------------------------------------------------------------------
  // Man-made slopes: toggle + "Feature to be displayed" search. Searching
  // filters the layer to matches and zooms to the first hit.
  // ------------------------------------------------------------------------
  const handleSlopesToggle = useCallback((enabled) => {
    setSlopes((s) => ({ ...s, enabled }));
  }, []);

  // Slope symbology + label toggle. `showLabels` is top-level; everything else
  // is a style property.
  const handleSlopesStyle = useCallback((patch) => {
    setSlopes((s) =>
      'showLabels' in patch
        ? { ...s, showLabels: patch.showLabels }
        : { ...s, style: { ...s.style, ...patch } }
    );
  }, []);

  const handleSlopeSearch = useCallback(
    async (text) => {
      const t = String(text ?? '').trim();
      setSlopes({ enabled: true, filter: t });
      if (!t) {
        setSlopesMsg(null);
        return;
      }
      setSlopesMsg({ kind: 'info', text: `Searching slopes for “${t}”…` });
      try {
        const { count, extent2326, first } = await searchSlopes(t);
        if (!count) {
          setSlopesMsg({ kind: 'warn', text: `No slope matches “${t}”.` });
          return;
        }
        setSlopesMsg({
          kind: 'ok',
          text: `${count >= 50 ? '50+' : count} match(es) — showing matches only. First: ${first.slopeNo}${
            first.location ? ` (${first.location})` : ''
          }.`,
        });
        if (extent2326) requestZoom(extent2326);
      } catch (err) {
        setSlopesMsg({ kind: 'error', text: `Slope search failed: ${err.message}` });
      }
    },
    [requestZoom]
  );

  // ------------------------------------------------------------------------
  // Derived view state.
  // ------------------------------------------------------------------------
  const placedAerials = useMemo(() => aerials.filter((a) => a.extent), [aerials]);
  const resolvedCount = placedAerials.length;

  // Timelapse frames: placed photos in chronological order.
  const timelapseFrames = useMemo(
    () =>
      placedAerials
        .map((a) => ({ id: a.id, year: photoYear(a), label: a.photono || a.filename }))
        .sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)),
    [placedAerials]
  );

  // Advance the timelapse while playing.
  useEffect(() => {
    if (!timelapse.enabled || !timelapse.playing || timelapseFrames.length < 2) return;
    const perMs =
      timelapse.mode === 'total'
        ? (timelapse.totalSec / timelapseFrames.length) * 1000
        : timelapse.perImageSec * 1000;
    const id = setInterval(() => {
      setTimelapse((t) => {
        const next = t.index + 1;
        if (next >= timelapseFrames.length) {
          return t.loop ? { ...t, index: 0 } : { ...t, index: timelapseFrames.length - 1, playing: false };
        }
        return { ...t, index: next };
      });
    }, Math.max(200, perMs));
    return () => clearInterval(id);
  }, [
    timelapse.enabled,
    timelapse.playing,
    timelapse.mode,
    timelapse.perImageSec,
    timelapse.totalSec,
    timelapse.loop,
    timelapseFrames.length,
  ]);

  // What MapView needs to render the current timelapse frame.
  const mapTimelapse = useMemo(() => {
    if (!timelapse.enabled || !timelapseFrames.length) return { active: false };
    const idx = Math.min(timelapse.index, timelapseFrames.length - 1);
    const frame = timelapseFrames[idx];
    return {
      active: true,
      currentId: frame.id,
      caption: frame.year != null ? String(frame.year) : frame.label,
      subCaption: frame.year != null ? frame.label : '',
    };
  }, [timelapse.enabled, timelapse.index, timelapseFrames]);

  // Validated compare sides (stale aerial ids fall back to sensible defaults).
  const sideSpecs = useMemo(() => {
    if (!swipe.enabled) return { left: null, right: null };
    const valid = (s) => {
      if (!s) return null;
      if (s === 'basemap' || s.startsWith('ortho:')) return s;
      if (s.startsWith('aerial:')) {
        const id = s.slice(7);
        return placedAerials.some((a) => a.id === id) ? s : null;
      }
      return null;
    };
    return {
      left: valid(swipe.left) ?? (placedAerials[0] ? `aerial:${placedAerials[0].id}` : 'ortho:1963'),
      right: valid(swipe.right) ?? 'basemap',
    };
  }, [swipe.enabled, swipe.left, swipe.right, placedAerials]);

  const georefAerial = georef ? aerials.find((a) => a.id === georef.aerialId) ?? null : null;

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      {/* ------------------------------ Sidebar ------------------------------ */}
      <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-slate-900">
        <header className="border-b border-slate-800 px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight">
            HKMS Aerial Photo Georeferencer
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Auto-place HKMS 2.0 vertical aerial photos on the Lands Department
            basemap using their HK 1980 Grid (EPSG:2326) bounding boxes.
          </p>
        </header>

        <AddDataSection
          autoLookup={autoLookup}
          onAutoLookupChange={setAutoLookup}
          onImageFiles={handleImageFiles}
          onCatalogFile={handleCatalogFile}
          onPasteTag={handlePasteTag}
          onVectorFile={handleVectorFile}
          catalogInfo={catalogInfo}
          matcherMsg={matcherMsg}
          vectorMsg={vectorMsg}
        />

        <MyDataSection
          aerials={aerials}
          vectors={vectors}
          resolvedCount={resolvedCount}
          onUpdateAerial={updateAerial}
          onUpdateAdjust={updateAdjust}
          onResetAdjust={resetAdjust}
          onRemoveAerial={removeAerial}
          onZoomTo={requestZoom}
          onLookupAerial={handleLookupAerial}
          onPlaceManually={handlePlaceManually}
          onStartGeoref={startGeoref}
          georefActiveId={georef?.aerialId ?? null}
          onUpdateVector={updateVector}
          onVectorStyle={updateVectorStyle}
          onRemoveVector={removeVector}
        />

        <BasemapSection
          basemapKey={basemapKey}
          onBasemapChange={setBasemapKey}
          orthoYear={orthoYear}
          onOrthoYearChange={setOrthoYear}
          compareActive={swipe.enabled}
          slopes={slopes}
          onSlopesToggle={handleSlopesToggle}
          onSlopeSearch={handleSlopeSearch}
          onSlopesStyle={handleSlopesStyle}
          slopesMsg={slopesMsg}
          flightPaths={flightPaths}
          onFlightPathsChange={setFlightPaths}
        />

        <CompareSection
          swipe={swipe}
          onSwipeChange={(next) => {
            if (next.enabled && !swipe.enabled) setTimelapse((t) => ({ ...t, enabled: false, playing: false }));
            setSwipe(next);
          }}
          sideSpecs={sideSpecs}
          placedAerials={placedAerials}
        />

        <TimelapseSection
          timelapse={timelapse}
          onChange={(next) => {
            // Timelapse and swipe fight over the map; turning one on turns the
            // other off.
            if (next.enabled && !timelapse.enabled) setSwipe((s) => ({ ...s, enabled: false }));
            setTimelapse(next);
          }}
          frames={timelapseFrames}
        />

        <ReportSection placedAerials={placedAerials} viewExtent={viewExtent} />

        <footer className="mt-auto px-5 py-3 text-[10px] leading-relaxed text-slate-500">
          Basemap © Lands Department, HKSAR Government (CSDI). Aerial photos ©
          Survey &amp; Mapping Office. Orthos © CEDD / GEO — reproduction by
          permission only.
        </footer>
      </aside>

      {/* ----------------------------- Map view ----------------------------- */}
      <main className="relative min-w-0 flex-1">
        <MapView
          aerials={aerials}
          vectors={vectors}
          basemapKey={basemapKey}
          orthoYear={orthoYear}
          slopes={slopes}
          flightPaths={flightPaths}
          timelapse={mapTimelapse}
          onViewCenter={(c) => (viewCenterRef.current = c)}
          onViewExtent={setViewExtent}
          onImageFiles={handleImageFiles}
          swipe={swipe}
          sideSpecs={sideSpecs}
          georef={georef}
          georefAerial={georefAerial}
          onGeorefClick={georefClick}
          onGeorefUndo={georefUndo}
          onGeorefClear={georefClear}
          onGeorefCancel={georefCancel}
          onGeorefApply={georefApply}
          onSwipePosition={(position) => setSwipe((s) => ({ ...s, position }))}
          zoomRequest={zoomRequest}
        />
      </main>
    </div>
  );
}

/** Walk a GeoJSON object and return the first [x, y] coordinate found. */
function firstCoordinate(geojson) {
  const geom =
    geojson.type === 'FeatureCollection'
      ? geojson.features?.[0]?.geometry
      : geojson.type === 'Feature'
        ? geojson.geometry
        : geojson;
  let c = geom?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === 'number' ? c : null;
}
