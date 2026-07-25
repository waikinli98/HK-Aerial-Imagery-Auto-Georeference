/**
 * Parsing helpers for the Automated Georeferencing Engine.
 *
 * Three independent metadata paths all resolve to the same shape:
 *   { photono: 'E067799C', extent: [minx, miny, maxx, maxy] }  (EPSG:2326)
 *
 *  1. Photo No. extraction from an uploaded file name (regex).
 *  2. HKMS 2.0 <img> tag paste → data-minx/miny/maxx/maxy attributes.
 *  3. Catalog upload (JSON array or CSV) → lookup table keyed by photono.
 */

/**
 * Extract the HKMS Photo No. from a file name.
 *
 * Modern numbers are letter-prefixed ("2019_E067799C.jpg" → E067799C). Older
 * photos are plain serials with no prefix ("1995_73576.jpg" → 73576 — stored
 * exactly like that in the HKMS index), so when no prefixed match exists we
 * take a standalone 4–6 digit group, skipping anything that reads as a year.
 */
export function extractPhotoNo(filename) {
  const up = filename.toUpperCase();
  const prefixed = up.match(/([A-Z]{1,2}\d{5,6}[A-Z]?)/);
  if (prefixed) return prefixed[1];
  const nums = [...up.matchAll(/(?<!\d)\d{4,6}(?!\d)/g)].map((m) => m[0]);
  const nonYear = nums.filter((n) => !/^(19|20)\d\d$/.test(n));
  return nonYear.length ? nonYear[nonYear.length - 1] : null;
}

/**
 * Parse an HKMS 2.0 <img> tag string (pasted from browser DevTools) and pull
 * out the photo number and EPSG:2326 bounding box from the data-* attributes.
 * Tolerant of attribute order, single/double quotes and extra whitespace.
 */
export function parseHkmsImgTag(html) {
  const attr = (name) => {
    const m = html.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const minx = parseFloat(attr('data-minx'));
  const miny = parseFloat(attr('data-miny'));
  const maxx = parseFloat(attr('data-maxx'));
  const maxy = parseFloat(attr('data-maxy'));
  const photono = attr('data-photono');

  if ([minx, miny, maxx, maxy].some(Number.isNaN)) {
    return { error: 'Could not find valid data-minx/miny/maxx/maxy attributes in the pasted tag.' };
  }
  if (minx >= maxx || miny >= maxy) {
    return { error: 'Bounding box is degenerate (min must be smaller than max).' };
  }
  return {
    photono: photono ? photono.toUpperCase() : null,
    extent: [minx, miny, maxx, maxy],
  };
}

/**
 * Parse a metadata catalog file (JSON or CSV) into a lookup map:
 *   Map<photono, [minx, miny, maxx, maxy]>
 *
 * JSON: an array of objects (or {records:[...]}) each carrying
 *       photono/minx/miny/maxx/maxy (case-insensitive keys).
 * CSV : first row is a header naming those same columns in any order.
 */
export function parseCatalog(text, filename) {
  const lookup = new Map();
  const put = (rec) => {
    // Normalise keys to lower case so PhotoNo / PHOTONO / photono all work.
    const r = {};
    for (const [k, v] of Object.entries(rec)) r[k.toLowerCase().trim()] = v;
    const photono = String(r.photono ?? r.photo_no ?? r.id ?? '').toUpperCase().trim();
    const extent = [r.minx, r.miny, r.maxx, r.maxy].map(Number);
    if (photono && !extent.some(Number.isNaN)) lookup.set(photono, extent);
  };

  if (/\.json$/i.test(filename) || text.trim().startsWith('[') || text.trim().startsWith('{')) {
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : data.records ?? data.features ?? [];
    rows.forEach(put);
  } else {
    // Minimal CSV parser — sufficient for numeric catalogs with no quoted commas.
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV needs a header row plus at least one data row.');
    const header = lines[0].split(',').map((h) => h.trim());
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const rec = {};
      header.forEach((h, i) => (rec[h] = cells[i]?.trim()));
      put(rec);
    }
  }
  if (lookup.size === 0) {
    throw new Error('No valid records found — expected columns photono, minx, miny, maxx, maxy.');
  }
  return lookup;
}
