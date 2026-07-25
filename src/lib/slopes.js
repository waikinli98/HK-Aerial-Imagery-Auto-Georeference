/**
 * CEDD Registered Man-made Slopes (CSDI open data).
 *
 * ArcGIS FeatureServer published on the CSDI portal (dataset
 * cedd_rcd_1636517655915_91216, data.gov.hk "Registered Man-made Slopes").
 * Layer 0 "Slopes" holds polygon footprints in EPSG:2326 with attributes
 * including SLOPE_NO (registration number, padded with irregular spaces,
 * e.g. " 6NW-C/C  340") and LOCATION (free-text description).
 *
 * The endpoint is CORS-open and needs no key. Features are loaded per view
 * bbox (there are tens of thousands territory-wide; maxRecordCount 3000).
 */

export const SLOPES_QUERY_URL =
  'https://portal.csdi.gov.hk/server/rest/services/common/cedd_rcd_1636517655915_91216/FeatureServer/0/query';

export const SLOPES_ATTRIBUTION =
  'Man-made slopes © <a href="https://portal.csdi.gov.hk" target="_blank">CEDD / CSDI</a>';

/** Default symbology for the slopes layer (red outline, hollow fill). */
export const DEFAULT_SLOPES_STYLE = {
  strokeColor: '#ef4444',
  strokeWidth: 2,
  strokeStyle: 'solid', // 'solid' | 'dashed' | 'dotted'
  fillColor: '#ef4444',
  fillOpacity: 0, // 0 = hollow
};

/**
 * Build an ArcGIS where clause for the "Feature to be displayed" search box.
 *
 * The CSDI portal sits behind a WAF that hard-drops requests containing the
 * SQL-injection signatures `LIKE … %` and `IN (…)` — but plain equality and
 * `LIKE` with only `_` single-character wildcards pass. Stored SLOPE_NO values
 * are fixed-width padded (e.g. " 6NW-C/C  340"), so we match a typed number
 * like "6NW-C/C 340" by OR-ing patterns whose padding is expressed as
 * underscores: `_6NW-C/C__340`, `6NW-C/C_340`, …
 */
export function buildSlopesWhere(text) {
  const raw = String(text ?? '').trim().toUpperCase().replace(/'/g, '');
  if (!raw) return '1=1';

  const clauses = [`SLOPE_NO = '${raw}'`]; // exact match, as typed
  const stripped = raw.replace(/\s+/g, '');
  // Slope registration numbers end in digits (e.g. 6NW-C/C340). Split into
  // prefix + number and re-insert the unknown padding as `_` wildcards.
  const m = stripped.match(/^(.*?[^\d])(\d+)$/);
  if (m) {
    const [, prefix, num] = m;
    for (let lead = 0; lead <= 2; lead++) {
      for (let mid = 0; mid <= 3; mid++) {
        clauses.push(`SLOPE_NO LIKE '${'_'.repeat(lead)}${prefix}${'_'.repeat(mid)}${num}'`);
      }
    }
  }
  return `(${clauses.join(' OR ')})`;
}

/**
 * Search slopes by number/location. Resolves to
 * `{ count, extent2326|null, first: { slopeNo, location }|null }`.
 * Count caps at 50 (enough to tell "many"); extent is the first match's
 * envelope padded for a comfortable zoom.
 */
export async function searchSlopes(text) {
  const params = new URLSearchParams({
    where: buildSlopesWhere(text),
    outFields: 'SLOPE_NO,LOCATION',
    returnGeometry: 'true',
    outSR: '2326',
    resultRecordCount: '50',
    f: 'json',
  });
  const res = await fetch(`${SLOPES_QUERY_URL}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'query error');
  const features = data.features ?? [];
  if (!features.length) return { count: 0, extent2326: null, first: null };

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of features[0].geometry?.rings ?? []) {
    for (const [x, y] of ring) {
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
  }
  const PAD = 60; // metres of context around a (typically small) slope polygon
  const extent2326 = Number.isFinite(minx)
    ? [minx - PAD, miny - PAD, maxx + PAD, maxy + PAD]
    : null;
  const a = features[0].attributes ?? {};
  return {
    count: features.length,
    extent2326,
    first: { slopeNo: (a.SLOPE_NO ?? '').trim(), location: a.LOCATION ?? '' },
  };
}
