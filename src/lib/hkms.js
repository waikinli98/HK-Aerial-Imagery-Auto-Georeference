/**
 * Online Photo No. → bounding-box lookup against HKMS 2.0.
 *
 * HKMS 2.0 publishes an aerial-photo index as an ArcGIS feature service. Layer
 * 2 (APIX_POLY) holds the footprint POLYGON of every vertical photo, keyed by
 * PHOTONO, in Hong Kong 1980 Grid (EPSG:2326). Querying it by photo number and
 * taking the polygon's envelope yields the exact same extent that HKMS embeds
 * as data-minx/miny/maxx/maxy in its portion-enlargement <img> tag — so a photo
 * can be georeferenced from its number alone, with no manual paste.
 *
 * The endpoint is CORS-open (verified from a localhost origin) and takes the
 * same public API key the HKMS 2.0 site itself uses. It can still rate-limit,
 * rotate the key, or go offline, so every caller must degrade gracefully to the
 * manual catalog/paste paths.
 */

const FLIGHTPATHS_POLY =
  'https://api.hkmapservice.gov.hk/oss/services/OneStop/FlightPaths/MapServer/2/query';

// Public map-API key embedded in the HKMS 2.0 One-Stop System front-end.
export const HKMS_API_KEY = 'dd970799919f49f3929ea6b2b5d47cf5';

/** Envelope [minx, miny, maxx, maxy] of an ArcGIS polygon geometry (rings). */
function ringsExtent(geometry) {
  if (!geometry || !geometry.rings) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of geometry.rings) {
    for (const [x, y] of ring) {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    }
  }
  return Number.isFinite(minx) ? [minx, miny, maxx, maxy] : null;
}

/**
 * Look up a photo's EPSG:2326 footprint extent by its Photo No.
 *
 * Resolves to `{ extent: [minx,miny,maxx,maxy], meta: { year, scale, flyingHt } }`,
 * or `null` if the photo isn't found. Rejects only on network/HTTP failure so
 * callers can distinguish "not found" from "lookup unavailable".
 */
export async function lookupPhotoExtent(photono, { signal } = {}) {
  const id = String(photono || '').toUpperCase().trim();
  if (!id) return null;

  const params = new URLSearchParams({
    where: `PHOTONO='${id.replace(/'/g, '')}'`,
    outFields: 'PHOTONO,YEARFLIGHT,PHOTOSCALE,FLYING_HT,ANGLE',
    returnGeometry: 'true',
    outSR: '2326',
    f: 'json',
    key: HKMS_API_KEY,
  });

  const res = await fetch(`${FLIGHTPATHS_POLY}?${params}`, { signal });
  if (!res.ok) throw new Error(`HKMS lookup HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'HKMS lookup error');

  const feature = data.features && data.features[0];
  const extent = feature && ringsExtent(feature.geometry);
  if (!extent) return null;

  const a = feature.attributes || {};
  return {
    extent: extent.map((v) => Math.round(v * 10) / 10),
    meta: {
      year: a.YEARFLIGHT ?? null,
      scale: a.PHOTOSCALE ?? null, // denominator, e.g. 3700 → 1:3700
      flyingHt: a.FLYING_HT ?? null, // feet
      // Flight-line azimuth (° clockwise from north). Scans are stored
      // flight-direction-up, so this tells us how to orient the content.
      angle: Number.isFinite(a.ANGLE) ? a.ANGLE : null,
    },
  };
}
