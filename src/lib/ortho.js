/**
 * CEDD historical orthophoto services (Ortho Photo group).
 *
 * These are ArcGIS MapServer cached services published by the Geotechnical
 * Engineering Office (GEO) of CEDD at ginfo.cedd.gov.hk. Their native tiling
 * scheme is Hong Kong 1980 Grid (EPSG:2326 / wkid 102140) and every request is
 * token-gated.
 *
 * Access strategy — why we go through a proxy
 * -------------------------------------------
 * The REST endpoints reject anonymous calls ("Token Required"). CEDD's public
 * Slope Information System reaches them through an unauthenticated resource
 * proxy that injects the ArcGIS token server-side:
 *
 *     https://ginfo.cedd.gov.hk/GInfoMap/DotNet/proxy.ashx?<target-url>
 *
 * That proxy answers with `Access-Control-Allow-Origin: https://hkss.cedd.gov.hk`,
 * so fetch()/XHR reads from any other origin are blocked by CORS. Plain <img>
 * loads, however, are not subject to that restriction — so we consume the
 * services as dynamic-export IMAGES (never reading their pixels back). We ask
 * the server to reproject to the map's view CRS (EPSG:3857) via imageSR, which
 * also avoids any client-side reprojection that would need canvas pixel access.
 *
 * Caveats worth knowing:
 *  - This depends on CEDD keeping that proxy open and unchanged; it can break
 *    without notice and is outside our control.
 *  - Because the tiles are cross-origin without CORS approval, the OpenLayers
 *    map canvas becomes "tainted" while an ortho layer is shown — display and
 *    the swipe clip still work, but map export/screenshot APIs would throw.
 *  - Imagery © CEDD / GEO, HKSAR Government. For reference use.
 */

/** CEDD resource proxy that injects the ArcGIS token server-side. */
export const CEDD_PROXY = 'https://ginfo.cedd.gov.hk/GInfoMap/DotNet/proxy.ashx?';

const ORTHO_BASE = 'https://ginfo.cedd.gov.hk/server/rest/services/Ortho';

/**
 * Selectable ortho years, newest first. `id` is used as the <select> value and
 * as the swipe "after" label suffix; `service` is the MapServer folder name.
 */
export const ORTHO_LAYERS = [
  { id: '2022', label: 'Year 2022', service: 'Ortho2022' },
  { id: '2021', label: 'Year 2021', service: 'Ortho2021' },
  { id: '2019', label: 'Year 2019', service: 'Ortho2019' },
  { id: '2018', label: 'Year 2018', service: 'Ortho2018' },
  { id: '2015', label: 'Year 2015', service: 'Ortho2015' },
  { id: '2014', label: 'Year 2014', service: 'Ortho2014R' },
  { id: '2012', label: 'Year 2012', service: 'Ortho2012' },
  { id: '2011', label: 'Year 2011 (LiDAR)', service: 'Ortho2012Lidar' },
  { id: '2008', label: 'Year 2008', service: 'Ortho2008' },
  { id: '2007', label: 'Year 2007', service: 'Ortho2007' },
  { id: '2005', label: 'Year 2005', service: 'Ortho2005' },
  { id: '2004', label: 'Year 2004', service: 'Ortho2004' },
  { id: '2003', label: 'Year 2003', service: 'Ortho2003' },
  { id: '2001', label: 'Year 2001', service: 'Ortho2001' },
  { id: '2000', label: 'Year 2000', service: 'Ortho2000' },
  { id: '1993', label: 'Year 1993', service: 'Ortho1993' },
  { id: '1982', label: 'Year 1982', service: 'Ortho1982' },
  { id: '1973', label: 'Year 1973–74', service: 'Ortho1973_74' },
  { id: '1963', label: 'Year 1963', service: 'Ortho1963' },
];

/** Full ArcGIS MapServer REST URL for an ortho year id (or null). */
export function orthoServiceUrl(id) {
  const entry = ORTHO_LAYERS.find((o) => o.id === id);
  return entry ? `${ORTHO_BASE}/${entry.service}/MapServer` : null;
}

/** Human label ("Year 2022") for an ortho year id, or null. */
export function orthoLabel(id) {
  return ORTHO_LAYERS.find((o) => o.id === id)?.label ?? null;
}

/**
 * Ortho year id closest to a photo's flight year — used to preselect the best
 * reference layer for control-point georeferencing.
 */
export function nearestOrthoYear(flightYear) {
  const y = Number(flightYear);
  if (!Number.isFinite(y)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const o of ORTHO_LAYERS) {
    const diff = Math.abs(Number(o.id) - y);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = o.id;
    }
  }
  return best;
}
