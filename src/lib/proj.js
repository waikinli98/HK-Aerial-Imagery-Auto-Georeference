/**
 * Coordinate Reference System setup.
 *
 * Registers EPSG:2326 (Hong Kong 1980 Grid System) with proj4 and wires it
 * into OpenLayers, so vectors/rasters defined in HK 1980 Grid can be
 * reprojected on the fly onto a Web Mercator (EPSG:3857) map view.
 */
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, transform } from 'ol/proj';

/**
 * Hong Kong 1980 Grid System — official proj4 definition incl. 7-parameter
 * datum shift to WGS84.
 *
 * NOTE the false northing is 819069.8 (official EPSG value). An earlier build
 * used 816240.09, which displaced every photo ~3 km north of where HKMS 2.0
 * shows it — verified against the FlightPaths service's own Web Mercator
 * output, which this definition now matches to within a few metres.
 */
export const EPSG_2326_DEF =
  '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 ' +
  '+x_0=836694.05 +y_0=819069.8 +ellps=intl ' +
  '+towgs84=-162.619,-276.959,-161.764,0.067753,-2.24365,-1.15883,-1.09425 ' +
  '+units=m +no_defs';

proj4.defs('EPSG:2326', EPSG_2326_DEF);
// Make every proj4-defined CRS (incl. EPSG:2326) available to OpenLayers.
register(proj4);

// Constrain the HK 1980 projection to its area of validity — this helps
// OpenLayers' raster-reprojection triangulation stay accurate and fast.
const hk1980 = getProjection('EPSG:2326');
hk1980.setExtent([793259, 799130, 870525, 848940]);

/** Convert an [minx, miny, maxx, maxy] extent from EPSG:2326 to EPSG:3857. */
export function hkExtentTo3857(extent) {
  const [minx, miny, maxx, maxy] = extent;
  const p1 = transform([minx, miny], 'EPSG:2326', 'EPSG:3857');
  const p2 = transform([maxx, maxy], 'EPSG:2326', 'EPSG:3857');
  return [p1[0], p1[1], p2[0], p2[1]];
}

/** Convert one map-view coordinate (EPSG:3857) to HK 1980 Grid (EPSG:2326). */
export function coord3857To2326(coord3857) {
  return transform(coord3857, 'EPSG:3857', 'EPSG:2326');
}

/** Convert one HK 1980 Grid coordinate (EPSG:2326) to the map view CRS. */
export function coord2326To3857(coord2326) {
  return transform(coord2326, 'EPSG:2326', 'EPSG:3857');
}

/** Format a coordinate pair from the map view (EPSG:3857) into both readouts. */
export function formatCoordinateReadout(coord3857) {
  const [lon, lat] = transform(coord3857, 'EPSG:3857', 'EPSG:4326');
  const [e, n] = transform(coord3857, 'EPSG:3857', 'EPSG:2326');
  return {
    wgs84: `${lat.toFixed(5)}°N  ${lon.toFixed(5)}°E`,
    hk1980: `E ${e.toFixed(1)}  N ${n.toFixed(1)}`,
  };
}
