# HKMS Aerial Photo Georeferencer

A single-page web app (React + Tailwind CSS + OpenLayers) that automates the
georeferencing, display and comparison of vertical aerial photographs
downloaded from Hong Kong's **HKMS 2.0** platform — replacing the manual
georeferencing workflow in ArcGIS Pro.

## How it works

HKMS 2.0 already embeds each photo's bounding box (Hong Kong 1980 Grid,
EPSG:2326) in its HTML:

```html
<img src="..." data-minx="817480.6" data-miny="831343.6"
     data-maxx="818209.9" data-maxy="832456.2" data-photono="E067799C">
```

The app extracts the Photo No. from an uploaded file name (e.g.
`2019_E067799C.jpg` → `E067799C`), resolves its bounding box, and renders the
raster in-place over the official Lands Department basemap. OpenLayers
reprojects the EPSG:2326 image onto the Web Mercator view on the fly using the
full 7-parameter datum transformation.

The bounding box can be resolved automatically online: HKMS 2.0 publishes an
aerial-photo index (an ArcGIS feature service, `OneStop/FlightPaths` layer 2
`APIX_POLY`) whose footprint polygons, keyed by `PHOTONO`, are the exact same
extents it embeds in the `<img>` tag. The app queries it by Photo No. and takes
the polygon's envelope — so most photos georeference from their filename alone.

## Features

- **Automated georeferencing** — resolution paths, tried in order:
  - *Online lookup (default)*: the Photo No. is looked up in the HKMS 2.0
    aerial-photo index; the footprint's bounding box, flight year and scale are
    filled in automatically. A typed Photo No. can be looked up directly too.
    (Toggle off to work fully offline.)
  - *Option A*: upload a JSON/CSV catalog (`photono, minx, miny, maxx, maxy`)
    used as a lookup table; pending photos are back-filled automatically.
  - *Option B*: paste the HKMS `<img>` tag; the `data-*` attributes are parsed
    and matched to the uploaded photo by `data-photono` (or the first
    unresolved photo). Parsed boxes are also cached for later uploads.
- **Historical ortho overlay (CEDD)** — 19 years of government orthophotos
  (1963–2022) from CEDD/GEO's map services, selectable as an overlay drawn
  above the basemap and below your photos, so a scanned aerial can be swiped
  directly against the official ortho of any year. Requests are reprojected to
  the view CRS server-side and routed through CEDD's public map proxy (loaded as
  images, so the proxy's origin-locked CORS header doesn't block display);
  availability depends on that service staying up.
- **Two-sided compare** — both sides of the split-screen divider are
  independently selectable: any imported photo, any CEDD ortho year, or the
  current basemap (e.g. ortho 1963 vs ortho 2022 for change detection, or a
  scanned photo vs its nearest ortho year). On-map labels track each side.
- **Manual georeference adjustment** — every placed photo expands (in "My
  Data") into a move / scale / rotate panel (nudge arrows with step size,
  sliders, reset). The adjustment is a 4-parameter similarity transform in
  EPSG:2326; rotation is baked into a canvas since ImageStatic is axis-aligned.
- **Control-point georeferencing** — for a photo placed only approximately:
  pick ≥ 3 point pairs (feature on the photo → its true position on the
  reference; building corners, road junctions and sports pitches work best).
  A least-squares Helmert fit (translate + rotate + uniform scale) is applied
  with live RMS feedback, and the reference layer preselects the CEDD ortho
  year nearest the photo's flight year.
- **Vector import** — zipped Shapefiles (via `shpjs`) and GeoJSON, with live
  symbology controls (fill colour/opacity, stroke colour/width). GeoJSON
  coordinates outside ±360 are auto-detected as EPSG:2326.
- **Auto-orientation** — each placed photo is oriented automatically from its
  flight azimuth (`ANGLE` in the HKMS index) combined with its aspect ratio:
  modern north-up products stay as-is, quarter-turned frames get 90°/270°, and
  old square film scans (flight-direction-up) get the full azimuth rotation
  with the envelope shrink. Verified against real 1995/2019/2021 downloads.
- **Flight paths & photo centres** — the HKMS flight-route lines and per-photo
  dots for any year (1963–2025); clicking a dot turns it red, draws that
  photo's footprint, and shows a popup with its details plus a **Download**
  button (opens the official CSDI open-data page for that sheet — the download
  itself is reCAPTCHA-gated there, which the app respects rather than bypasses)
  and an **Add to map** shortcut.
- **Timelapse** — plays the placed photos in chronological order, one full
  frame at a time, with a big year caption; set either the per-image duration
  or the total sequence length, with loop and a scrubber.
- **One-Key Report** — three tools over the reviewed photos: a checkable
  **image list** (Photo No. / scale / flight height) exportable to CSV; an
  **interpretation report** (choose years + optionally crop to the current map
  view) opened as a printable/PDF page grouped by year; and a **change
  description** between two photos (computed year gap and footprint overlap
  plus an editable observations note).
- **Viewing scale** — a live `1:N` readout that doubles as an input: type a
  scale and the map zooms to it (latitude-corrected for EPSG:3857).
- **Slope symbology** — the man-made-slopes layer takes an optional
  registration-number label and full style control: outline colour / style
  (solid/dashed/dotted) / width, and fill colour / opacity (0 = hollow).
- **ArcGIS Pro toolbox** — `arcgis/HKMSGeoreferencer.pyt` brings the same
  auto-georeferencing into ArcGIS Pro (just the georeferencing — no web-only
  timelapse/slope features). Point it at your HKMS photo files; it looks each
  one up in the index and writes rotation-aware world files (`.wld` +
  format-specific `.jgw`/`.tfw`/`.pgw`) plus a `.prj` (EPSG:2326) next to each
  image, so they load already georeferenced and oriented, then optionally adds
  them to the current map. Image size is read via Pillow (JPEG/PNG/TIFF) with a
  header-parser fallback. Note: ArcGIS reads raw pixels and ignores EXIF, which
  the affine accounts for; photos absent from the index (e.g. some pre-1970
  sorties) are reported for manual placement. Verified on real 1988–2024
  downloads: 0.00 m centre error, correct flight-direction rotation.
- **CEDD Man-made Slopes** — the registered man-made slopes layer (CSDI open
  data) as a toggleable reference overlay, red boundary with hollow fill,
  loaded per view bbox. A "Feature to be displayed" search bar finds a slope by
  its registration number (padding-tolerant), filters the layer to matches and
  zooms to the first hit. Note: the CSDI WAF drops SQL-wildcard queries
  (`LIKE '%…%'`, `IN (…)`), so matching uses equality plus `_`-wildcard LIKE
  patterns only.
- **Split-screen swipe** — canvas-clipped Before/After comparison of a chosen
  aerial photo against the modern basemap, with a draggable on-map handle +
  slider, a photo picker, and on-map labels showing the displayed photo (left)
  and basemap (right).
- **Format guard** — every upload is preflight-decoded; formats the browser
  cannot render (TIFF, JPEG 2000…) are flagged with a "Can't display" status
  instead of silently showing nothing.
- **Basemaps** — LandsD Topographic and Imagery (CSDI open XYZ endpoints) with
  the separate label layer, plus an OpenStreetMap fallback.
- **Dual-CRS readout** — live WGS84 lat/lon and HK 1980 Grid coordinates under
  the cursor.

## Run

```bash
npm install
npm run dev     # http://localhost:5178
npm run build   # production build in dist/
```

## Key files

| File | Purpose |
| --- | --- |
| `src/lib/proj.js` | EPSG:2326 proj4 definition + OpenLayers registration |
| `src/lib/parse.js` | Photo No. regex, `<img>` tag parser, catalog parser |
| `src/lib/hkms.js` | Online Photo No. → bounding-box lookup (HKMS 2.0 index) |
| `src/lib/ortho.js` | CEDD ortho service catalog + proxy access strategy |
| `src/lib/slopes.js` | CEDD man-made slopes service + WAF-safe search clauses |
| `src/lib/georef.js` | Similarity adjust, rotation bake, Helmert control-point fit |
| `src/lib/georef.js` | Similarity-adjust math, Helmert solver, rotation bake |
| `src/App.jsx` | Application state + sidebar/map wiring |
| `src/components/MapView.jsx` | OL map, adjusted rasters, two-sided swipe, CP mode |
| `src/components/AddDataSection.jsx` | Uploads, auto-lookup, offline options |
| `src/components/MyDataSection.jsx` | Unified layer list + adjustment/symbology panels |
| `src/components/BasemapSection.jsx` | Basemap + ortho overlay controls |
| `src/components/CompareSection.jsx` | Split-view side selectors + position |

> Basemap © Lands Department, HKSAR Government (CSDI). Aerial photos © Survey
> & Mapping Office. Historical orthophotos © CEDD / GEO, HKSAR Government.
> Reproduction by permission only.
