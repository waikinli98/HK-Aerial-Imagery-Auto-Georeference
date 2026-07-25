/**
 * HKMS 2.0 flight-path layers (photo centres + flight routes), mirroring what
 * the HKMS map viewer shows: tan photo-centre dots along blue flight lines,
 * and — on clicking a dot — that photo's green footprint.
 *
 * Same FlightPaths MapServer as the bbox lookup:
 *   layer 0 APIX_POINT — one point per vertical photo (63k+ per recent year,
 *                        so always load per view bbox);
 *   layer 1 APIX_ARC   — flight lines (~500 per year, loaded per year in one
 *                        request);
 *   layer 2 APIX_POLY  — footprints (queried per photo on click).
 *
 * Server quirk (verified): these layers reject queries with a LIMITED
 * outFields list ("Failed to execute query") — always send outFields=*.
 */
import { HKMS_API_KEY } from './hkms.js';

export const FLIGHTPATHS_BASE =
  'https://api.hkmapservice.gov.hk/oss/services/OneStop/FlightPaths/MapServer';

/** Years offered by the HKMS aerial-photo search. */
export const FLIGHT_YEARS = [
  2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014,
  2013, 2012, 2011, 2010, 2009, 2008, 2007, 2006, 2005, 2004, 2003, 2002,
  2001, 2000, 1999, 1998, 1997, 1996, 1995, 1994, 1993, 1992, 1991, 1990,
  1989, 1988, 1987, 1986, 1985, 1984, 1983, 1982, 1981, 1980, 1979, 1978,
  1977, 1976, 1975, 1974, 1973, 1972, 1970, 1969, 1968, 1967, 1964, 1963,
];

/**
 * Official CSDI open-data download page for a Digital Aerial Photo sheet.
 * Opening this (rather than scripting the download) respects the site's
 * reCAPTCHA gate — the user completes the check and downloads there, then adds
 * the JPEG here where it auto-georeferences by its sheet name.
 */
export function dapDownloadUrl(photono, format = 'JPEG') {
  const params = new URLSearchParams({
    productName: 'DAP',
    sheetName: String(photono),
    productFormat: format,
    locale: 'en',
  });
  return `https://open.hkmapservice.gov.hk/OpenData/productView?${params}`;
}

/** Query URL for a year's features on a layer, optionally within a 3857 bbox. */
export function flightQueryUrl(layerId, year, extent3857) {
  const params = new URLSearchParams({
    where: `YEARFLIGHT=${Number(year)}`,
    outFields: '*', // limited field lists make this server error out
    returnGeometry: 'true',
    outSR: '102100',
    f: 'json',
    key: HKMS_API_KEY,
  });
  if (extent3857) {
    params.set('geometry', extent3857.join(','));
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '102100');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${FLIGHTPATHS_BASE}/${layerId}/query?${params}`;
}

/** Fetch one photo's footprint rings in EPSG:2326 (or null). */
export async function fetchPhotoFootprint(photono) {
  const params = new URLSearchParams({
    where: `PHOTONO='${String(photono).replace(/'/g, '')}'`,
    outFields: 'PHOTONO,YEARFLIGHT,PHOTOSCALE,FLYING_HT,DATEFLIGHT',
    returnGeometry: 'true',
    outSR: '2326',
    f: 'json',
    key: HKMS_API_KEY,
  });
  const res = await fetch(`${FLIGHTPATHS_BASE}/2/query?${params}`);
  const data = await res.json();
  const f = data.features?.[0];
  if (!f?.geometry?.rings) return null;
  return { rings: f.geometry.rings, attrs: f.attributes ?? {} };
}
