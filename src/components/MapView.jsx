/**
 * MapView — OpenLayers map with:
 *  - LandsD CSDI XYZ basemaps (+ bilingual labels) and an OSM fallback;
 *  - CEDD historical ortho layers (standalone overlay, or per compare-side);
 *  - georeferenced aerial photo overlays (ImageStatic in EPSG:2326) with a
 *    per-photo similarity adjustment — translation/scale via extent math,
 *    rotation baked into a canvas (ImageStatic is axis-aligned only);
 *  - a two-sided split view: each side of the divider independently shows an
 *    aerial photo, an ortho year, or the basemap (canvas clip per side);
 *  - a control-point georeferencing mode (click pairs photo → reference);
 *  - imported vector layers with live symbology;
 *  - a dual CRS mouse readout (WGS84 + HK 1980 Grid).
 */
import { useEffect, useRef, useState } from 'react';
import OlMap from 'ol/Map'; // aliased so it doesn't shadow the JS built-in Map
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import XYZ from 'ol/source/XYZ';
import OSM from 'ol/source/OSM';
import Static from 'ol/source/ImageStatic';
import ImageArcGISRest from 'ol/source/ImageArcGISRest';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import EsriJSON from 'ol/format/EsriJSON';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { ScaleLine, defaults as defaultControls } from 'ol/control';
import { fromLonLat, toLonLat, getPointResolution } from 'ol/proj';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import {
  hkExtentTo3857,
  coord3857To2326,
  coord2326To3857,
  formatCoordinateReadout,
} from '../lib/proj.js';
import { CEDD_PROXY, orthoServiceUrl, orthoLabel } from '../lib/ortho.js';
import { SLOPES_QUERY_URL, SLOPES_ATTRIBUTION, buildSlopesWhere } from '../lib/slopes.js';
import { flightQueryUrl, fetchPhotoFootprint, dapDownloadUrl } from '../lib/flightpaths.js';
import { DEFAULT_SLOPES_STYLE } from '../lib/slopes.js';
import {
  DEFAULT_ADJUST,
  adjustExtentNoRotation,
  bakeAdjustedImage,
  solveHelmert,
} from '../lib/georef.js';

const LANDSD_ATTRIBUTION =
  '© Map information from Lands Department <a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank">HKSAR Gov</a>';
const CEDD_ATTRIBUTION =
  'Ortho imagery © <a href="https://www.cedd.gov.hk" target="_blank">CEDD / GEO</a>, HKSAR Gov';

/** CSDI / HK GeoData Store open XYZ endpoints (Web Mercator tile scheme). */
const BASEMAP_URLS = {
  'landsd-topo': 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
  'landsd-imagery': 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/wgs84/{z}/{x}/{y}.png',
  'landsd-label': 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/en/wgs84/{z}/{x}/{y}.png',
};

const BASEMAP_LABELS = {
  'landsd-topo': 'LandsD Topographic',
  'landsd-imagery': 'LandsD Imagery',
  osm: 'OpenStreetMap',
};

const stripExtension = (filename) => filename.replace(/\.[^.]+$/, '');

/** Build an ol.Style from a vector layer's symbology settings. */
function buildStyle({ fillColor, fillOpacity, strokeColor, strokeWidth }) {
  const fill = new Fill({ color: hexToRgba(fillColor, fillOpacity) });
  const stroke = new Stroke({ color: strokeColor, width: strokeWidth });
  return new Style({
    fill,
    stroke,
    image: new CircleStyle({ radius: Math.max(4, strokeWidth + 3), fill, stroke }),
  });
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A CEDD ortho ImageLayer (dynamic export through the token proxy). */
function createOrthoLayer(serviceUrl, zIndex) {
  return new ImageLayer({
    zIndex,
    // Cached only ~1:250 000–1:500; beyond the coarsest level the server
    // returns an opaque nodata image, so don't draw past it.
    maxResolution: 66,
    source: new ImageArcGISRest({
      url: serviceUrl,
      attributions: CEDD_ATTRIBUTION,
      ratio: 1,
      params: { FORMAT: 'PNG32', TRANSPARENT: 'true' },
      // Loaded as an image (never fetched/read), so the proxy's origin-locked
      // CORS header doesn't block display. See lib/ortho.js.
      imageLoadFunction: (image, src) => {
        image.getImage().src = CEDD_PROXY + src;
      },
    }),
  });
}

/**
 * Clip a layer's canvas to its assigned side of the swipe divider. The side
 * lives on the layer ('swipeSide': 'left' | 'right' | null) so it can be
 * reassigned without re-wiring render hooks.
 */
function attachSideClipping(layer, swipeRef) {
  layer.on('prerender', (evt) => {
    const { enabled, position } = swipeRef.current;
    const side = layer.get('swipeSide');
    if (!enabled || !side) return;
    const ctx = evt.context;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const split = w * position;
    ctx.save();
    ctx.beginPath();
    if (side === 'left') ctx.rect(0, 0, split, h);
    else ctx.rect(split, 0, w - split, h);
    ctx.clip();
    layer.set('swipeClipped', true);
  });
  layer.on('postrender', (evt) => {
    if (layer.get('swipeClipped')) {
      evt.context.restore();
      layer.set('swipeClipped', false);
    }
  });
}

/* ------------------------- control-point styling ------------------------- */

const CP_SRC_STYLE = (label) =>
  new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: 'rgba(249,115,22,0.9)' }), // orange = on photo
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -14,
      font: 'bold 11px sans-serif',
      fill: new Fill({ color: '#fff' }),
      stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 3 }),
    }),
  });

const CP_DST_STYLE = (label) =>
  new Style({
    image: new CircleStyle({
      radius: 7,
      fill: new Fill({ color: 'rgba(16,185,129,0.9)' }), // green = reference
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -14,
      font: 'bold 11px sans-serif',
      fill: new Fill({ color: '#fff' }),
      stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 3 }),
    }),
  });

const CP_LINE_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(255,255,255,0.85)', width: 1.5, lineDash: [6, 4] }),
});

const CP_DRAFT_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(249,115,22,0.35)' }),
    stroke: new Stroke({ color: '#f97316', width: 2, lineDash: [4, 3] }),
  }),
});

/**
 * Build the slopes style function from the user's symbology + label toggle.
 * Hollow when fillOpacity is 0; SLOPE_NO label drawn when showLabels is on.
 */
function buildSlopesStyleFn(style = DEFAULT_SLOPES_STYLE, showLabels = false) {
  const dash =
    style.strokeStyle === 'dashed'
      ? [8, 5]
      : style.strokeStyle === 'dotted'
        ? [1, 4]
        : undefined;
  const stroke = new Stroke({ color: style.strokeColor, width: style.strokeWidth, lineDash: dash });
  const fill =
    style.fillOpacity > 0 ? new Fill({ color: hexToRgba(style.fillColor, style.fillOpacity) }) : null;
  const base = new Style({ stroke, fill: fill ?? undefined });
  if (!showLabels) return base;
  return (feature) => {
    const label = String(feature.get('SLOPE_NO') ?? '').trim();
    return new Style({
      stroke,
      fill: fill ?? undefined,
      text: new Text({
        text: label,
        font: 'bold 10px sans-serif',
        fill: new Fill({ color: '#fff' }),
        stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 3 }),
        overflow: true,
      }),
    });
  };
}

/* HKMS flight-path styling — blue routes, tan photo-centre dots, and the
   clicked photo's footprint in HKMS-like green with a red dashed border. */
const FP_ARC_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(59,130,246,0.75)', width: 1.5 }),
});
const FP_POINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: 'rgba(217,119,6,0.85)' }),
    stroke: new Stroke({ color: '#fff', width: 1 }),
  }),
});
/** The clicked photo-centre dot turns red and slightly larger. */
const FP_POINT_SELECTED_STYLE = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(239,68,68,0.95)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});
const FP_FOOTPRINT_STYLE = new Style({
  fill: new Fill({ color: 'rgba(74,222,128,0.30)' }),
  stroke: new Stroke({ color: '#ef4444', width: 2, lineDash: [8, 5] }),
});

/** Photo bounding-box preview — dashed sky outline + Photo No. label. */
const bboxStyle = (label) =>
  new Style({
    stroke: new Stroke({ color: '#38bdf8', width: 2, lineDash: [8, 5] }),
    text: new Text({
      text: label,
      font: 'bold 11px sans-serif',
      fill: new Fill({ color: '#38bdf8' }),
      stroke: new Stroke({ color: 'rgba(0,0,0,0.75)', width: 3 }),
      overflow: true,
    }),
  });

export default function MapView({
  aerials,
  vectors,
  basemapKey,
  orthoYear,
  slopes,
  flightPaths,
  timelapse,
  onViewCenter,
  onViewExtent,
  onImageFiles,
  swipe,
  sideSpecs,
  georef,
  georefAerial,
  onGeorefClick,
  onGeorefUndo,
  onGeorefClear,
  onGeorefCancel,
  onGeorefApply,
  onSwipePosition,
  zoomRequest,
}) {
  const containerRef = useRef(null);
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const basemapLayersRef = useRef({});
  const orthoLayerRef = useRef(null); // standalone overlay
  const sideOrthoRef = useRef({ left: null, right: null }); // {year, layer}
  const aerialLayersRef = useRef(new Map()); // aerial id -> ImageLayer
  const vectorLayersRef = useRef(new Map()); // vector id -> VectorLayer
  const cpLayerRef = useRef(null); // control-point markers
  const fittedRef = useRef(new Map()); // aerial id -> base extent key already fitted
  const imgElCacheRef = useRef(new Map()); // aerial id -> {url, promise<Image>}
  const bakedRef = useRef(new Map()); // aerial id -> {key, url, extent}
  const bakingRef = useRef(new Map()); // aerial id -> key in flight
  const [bakeTick, setBakeTick] = useState(0); // bumped when a bake lands

  const slopesLayerRef = useRef(null);
  const slopesFilterRef = useRef('');
  const bboxLayerRef = useRef(null); // photo bounding-box outlines
  const fpArcsRef = useRef(null); // flight routes layer
  const fpPointsRef = useRef(null); // photo-centre points layer
  const fpSelRef = useRef(null); // selected photo footprint layer
  const fpYearRef = useRef(null);
  const fpSelFeatureRef = useRef(null); // the clicked dot (to restyle red / reset)
  const [selectedFlight, setSelectedFlight] = useState(null); // clicked photo info
  const addFileInputRef = useRef(null); // hidden input for "add downloaded file"
  const [mapScale, setMapScale] = useState(null); // current 1:N denominator
  const [scaleInput, setScaleInput] = useState('');

  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;
  const georefRef = useRef(georef);
  georefRef.current = georef;
  const onGeorefClickRef = useRef(onGeorefClick);
  onGeorefClickRef.current = onGeorefClick;
  const onViewCenterRef = useRef(onViewCenter);
  onViewCenterRef.current = onViewCenter;
  const onViewExtentRef = useRef(onViewExtent);
  onViewExtentRef.current = onViewExtent;
  const flightRef = useRef(flightPaths);
  flightRef.current = flightPaths;

  const [readout, setReadout] = useState(null);

  // --------------------------- map construction ---------------------------
  useEffect(() => {
    const landsdTopo = new TileLayer({
      source: new XYZ({ url: BASEMAP_URLS['landsd-topo'], attributions: LANDSD_ATTRIBUTION, maxZoom: 20 }),
      zIndex: 0,
    });
    const landsdImagery = new TileLayer({
      source: new XYZ({ url: BASEMAP_URLS['landsd-imagery'], attributions: LANDSD_ATTRIBUTION, maxZoom: 20 }),
      zIndex: 0,
      visible: false,
    });
    const landsdLabel = new TileLayer({
      source: new XYZ({ url: BASEMAP_URLS['landsd-label'], maxZoom: 20 }),
      zIndex: 1,
    });
    const osm = new TileLayer({ source: new OSM(), zIndex: 0, visible: false });
    basemapLayersRef.current = { landsdTopo, landsdImagery, landsdLabel, osm };

    const map = new OlMap({
      target: mapElRef.current,
      layers: [landsdTopo, landsdImagery, osm, landsdLabel],
      controls: defaultControls().extend([new ScaleLine({ units: 'metric' })]),
      view: new View({
        center: fromLonLat([114.1095, 22.3964]), // Hong Kong
        zoom: 11,
        maxZoom: 21,
      }),
    });

    map.on('pointermove', (evt) => {
      if (evt.dragging) return;
      setReadout(formatCoordinateReadout(evt.coordinate));
    });
    map.getViewport().addEventListener('mouseleave', () => setReadout(null));

    // Control-point picking (georef session) takes priority; otherwise a
    // click on a flight-path photo-centre dot reveals that photo's footprint.
    map.on('singleclick', (evt) => {
      if (georefRef.current) {
        onGeorefClickRef.current(coord3857To2326(evt.coordinate));
        return;
      }
      if (!flightRef.current?.enabled) return;
      let hit = null;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => { hit = feature; return true; },
        { hitTolerance: 6, layerFilter: (l) => l === fpPointsRef.current }
      );
      if (!hit) {
        setSelectedFlight(null);
        fpSelRef.current?.getSource().clear();
        if (fpSelFeatureRef.current) fpSelFeatureRef.current.setStyle(undefined);
        fpSelFeatureRef.current = null;
        return;
      }
      // Turn the previously-selected dot back to tan, this one red.
      if (fpSelFeatureRef.current && fpSelFeatureRef.current !== hit) {
        fpSelFeatureRef.current.setStyle(undefined);
      }
      hit.setStyle(FP_POINT_SELECTED_STYLE);
      fpSelFeatureRef.current = hit;
      const photono = hit.get('PHOTONO');
      setSelectedFlight({ photono, loading: true });
      fetchPhotoFootprint(photono)
        .then((fp) => {
          if (!fp) {
            setSelectedFlight({ photono, missing: true });
            return;
          }
          const rings3857 = fp.rings.map((ring) => ring.map(coord2326To3857));
          if (fpSelRef.current) {
            const src = fpSelRef.current.getSource();
            src.clear();
            const feat = new Feature(new Polygon(rings3857));
            feat.setStyle(FP_FOOTPRINT_STYLE);
            src.addFeature(feat);
          }
          setSelectedFlight({
            photono,
            year: fp.attrs.YEARFLIGHT,
            scale: fp.attrs.PHOTOSCALE,
            flyingHt: fp.attrs.FLYING_HT,
            date: fp.attrs.DATEFLIGHT ? new Date(fp.attrs.DATEFLIGHT).toISOString().slice(0, 10) : null,
          });
        })
        .catch(() => setSelectedFlight({ photono, missing: true }));
    });

    // Keep the app informed of the view centre, extent (EPSG:2326) + scale.
    const reportCenter = () => {
      const view = map.getView();
      onViewCenterRef.current?.(coord3857To2326(view.getCenter()));
      setMapScale(resolutionToScale(view.getResolution(), view.getCenter()));
      const size = map.getSize();
      if (size && onViewExtentRef.current) {
        const [minx, miny, maxx, maxy] = view.calculateExtent(size);
        const sw = coord3857To2326([minx, miny]);
        const ne = coord3857To2326([maxx, maxy]);
        onViewExtentRef.current([sw[0], sw[1], ne[0], ne[1]]);
      }
    };
    map.on('moveend', reportCenter);
    reportCenter();

    mapRef.current = map;
    if (import.meta.env.DEV) {
      window.__olmap = map; // dev-only handles for testing
      window.__to3857 = coord2326To3857;
    }
    return () => {
      map.setTarget(null);
      mapRef.current = null;
    };
  }, []);

  // ----------------------------- basemap toggle ---------------------------
  useEffect(() => {
    const { landsdTopo, landsdImagery, landsdLabel, osm } = basemapLayersRef.current;
    if (!landsdTopo) return;
    landsdTopo.setVisible(basemapKey === 'landsd-topo');
    landsdImagery.setVisible(basemapKey === 'landsd-imagery');
    landsdLabel.setVisible(basemapKey !== 'osm');
    osm.setVisible(basemapKey === 'osm');
  }, [basemapKey]);

  // ---------------------- standalone CEDD ortho overlay -------------------
  // Hidden while the compare is on: there the two sides define the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const serviceUrl = orthoServiceUrl(orthoYear);
    if (!serviceUrl) {
      if (orthoLayerRef.current) {
        map.removeLayer(orthoLayerRef.current);
        orthoLayerRef.current = null;
      }
      return;
    }
    if (!orthoLayerRef.current) {
      orthoLayerRef.current = createOrthoLayer(serviceUrl, 5);
      map.addLayer(orthoLayerRef.current);
    } else {
      orthoLayerRef.current.getSource().setUrl(serviceUrl);
      orthoLayerRef.current.getSource().refresh();
    }
    orthoLayerRef.current.setVisible(!swipe.enabled);
  }, [orthoYear, swipe.enabled]);

  // ------------------------- compare-side ortho layers --------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const side of ['left', 'right']) {
      const spec = sideSpecs?.[side];
      const year = spec?.startsWith('ortho:') ? spec.slice(6) : null;
      const cur = sideOrthoRef.current[side];
      if (!year) {
        if (cur) {
          map.removeLayer(cur.layer);
          sideOrthoRef.current[side] = null;
        }
        continue;
      }
      if (cur && cur.year !== year) {
        cur.layer.getSource().setUrl(orthoServiceUrl(year));
        cur.layer.getSource().refresh();
        cur.year = year;
      } else if (!cur) {
        const layer = createOrthoLayer(orthoServiceUrl(year), 6);
        attachSideClipping(layer, swipeRef);
        layer.set('swipeSide', side);
        map.addLayer(layer);
        sideOrthoRef.current[side] = { year, layer };
      }
    }
    map.render();
  }, [sideSpecs]);

  // ----------------------- CEDD man-made slopes layer ---------------------
  // Vector features loaded per view bbox from the CSDI FeatureServer (tens of
  // thousands territory-wide, so only past ~1:20 000). The "Feature to be
  // displayed" search narrows the where clause and triggers a reload.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    slopesFilterRef.current = slopes?.filter ?? '';

    if (!slopes?.enabled) {
      if (slopesLayerRef.current) {
        map.removeLayer(slopesLayerRef.current);
        slopesLayerRef.current = null;
      }
      return;
    }

    if (!slopesLayerRef.current) {
      const source = new VectorSource({
        strategy: bboxStrategy,
        attributions: SLOPES_ATTRIBUTION,
        loader: async (extent) => {
          try {
            const params = new URLSearchParams({
              geometry: extent.join(','),
              geometryType: 'esriGeometryEnvelope',
              inSR: '102100',
              spatialRel: 'esriSpatialRelIntersects',
              where: buildSlopesWhere(slopesFilterRef.current),
              outFields: 'OBJECTID,SLOPE_NO,LOCATION,MAINT_PART',
              returnGeometry: 'true',
              f: 'geojson',
            });
            const res = await fetch(`${SLOPES_QUERY_URL}?${params}`);
            const json = await res.json();
            const feats = new GeoJSON().readFeatures(json, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857',
            });
            // Adjacent bbox loads can return the same slope twice.
            const seen = new Set(source.getFeatures().map((f) => f.getId()));
            source.addFeatures(feats.filter((f) => !seen.has(f.getId())));
          } catch {
            /* network hiccup — the next pan/zoom retries */
          }
        },
      });
      slopesLayerRef.current = new VectorLayer({
        source,
        style: buildSlopesStyleFn(slopes.style, slopes.showLabels),
        zIndex: 25, // reference outlines above photos and orthos
        maxResolution: 20, // ≈ 1:20 000 in this latitude band
      });
      map.addLayer(slopesLayerRef.current);
    }
  }, [slopes?.enabled]);

  // Re-query when the display filter changes (clears the loaded-extent cache).
  useEffect(() => {
    slopesFilterRef.current = slopes?.filter ?? '';
    slopesLayerRef.current?.getSource().refresh();
  }, [slopes?.filter]);

  // Live symbology + label toggle for the slopes layer.
  useEffect(() => {
    slopesLayerRef.current?.setStyle(buildSlopesStyleFn(slopes?.style, slopes?.showLabels));
  }, [slopes?.style, slopes?.showLabels]);

  // --------------------------- aerial photo layers ------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = aerialLayersRef.current;
    const wanted = new Set();
    const swipeOn = !!(sideSpecs?.left || sideSpecs?.right);
    const georefId = georef?.aerialId ?? null;

    for (const aerial of aerials) {
      if (!aerial.extent) continue; // not georeferenced yet
      wanted.add(aerial.id);
      const adjust = aerial.adjust ?? DEFAULT_ADJUST;
      const orientation = aerial.orientation ?? 0;
      const adjustKey =
        aerial.extent.join(',') +
        `|${adjust.dx.toFixed(2)},${adjust.dy.toFixed(2)},${adjust.scale.toFixed(4)},${adjust.rotation.toFixed(2)},o${orientation}`;

      // Resolve what this aerial should display right now.
      let display = null;
      if (adjust.rotation === 0 && orientation === 0) {
        display = { url: aerial.url, extent: adjustExtentNoRotation(aerial.extent, adjust) };
      } else {
        const baked = bakedRef.current.get(aerial.id);
        if (baked && baked.key === adjustKey) {
          display = { url: baked.url, extent: baked.extent };
        } else if (bakingRef.current.get(aerial.id) !== adjustKey) {
          // Kick off a bake for this exact adjust; re-render lands via bakeTick.
          bakingRef.current.set(aerial.id, adjustKey);
          loadAerialImage(imgElCacheRef.current, aerial)
            .then((img) => bakeAdjustedImage(img, aerial.extent, adjust, orientation))
            .then(({ url, extent }) => {
              if (bakingRef.current.get(aerial.id) !== adjustKey) {
                URL.revokeObjectURL(url); // superseded while baking
                return;
              }
              const old = bakedRef.current.get(aerial.id);
              // Defer revoking the previous blob: OpenLayers may still be
              // reprojecting the outgoing layer, and revoking too early throws
              // an EncodingError mid-reprojection.
              if (old) setTimeout(() => URL.revokeObjectURL(old.url), 4000);
              bakedRef.current.set(aerial.id, { key: adjustKey, url, extent });
              bakingRef.current.delete(aerial.id);
              setBakeTick((t) => t + 1);
            })
            .catch(() => bakingRef.current.delete(aerial.id));
        }
        // While the bake is in flight keep showing the previous layer.
      }

      let layer = existing.get(aerial.id);
      if (display) {
        const layerKey = `${display.url}|${display.extent.join(',')}`;
        if (layer && layer.get('layerKey') !== layerKey) {
          map.removeLayer(layer);
          existing.delete(aerial.id);
          layer = null;
        }
        if (!layer) {
          layer = new ImageLayer({
            source: new Static({
              url: display.url,
              imageExtent: display.extent, // EPSG:2326 metres
              projection: 'EPSG:2326', // OL reprojects the raster to the view CRS
              interpolate: true,
            }),
            zIndex: 10,
          });
          layer.set('layerKey', layerKey);
          attachSideClipping(layer, swipeRef);
          map.addLayer(layer);
          existing.set(aerial.id, layer);
          // Fit once per photo placement (not on every nudge). Instant fit —
          // animated fits stall when the tab is unfocused (rAF throttling).
          const baseKey = aerial.extent.join(',');
          if (fittedRef.current.get(aerial.id) !== baseKey) {
            fittedRef.current.set(aerial.id, baseKey);
            map.getView().fit(hkExtentTo3857(aerial.extent), {
              padding: [60, 60, 60, 60],
              maxZoom: 19,
            });
          }
        }
      }
      if (!layer) continue;

      // Side assignment + visibility. Timelapse fully overrides swipe: the
      // current frame is shown un-clipped, one photo at a time.
      const side =
        timelapse?.active
          ? null
          : sideSpecs?.left === `aerial:${aerial.id}`
            ? 'left'
            : sideSpecs?.right === `aerial:${aerial.id}`
              ? 'right'
              : null;
      layer.set('swipeSide', side);
      layer.setVisible(
        timelapse?.active
          ? aerial.id === timelapse.currentId
          : swipeOn
            ? side !== null
            : aerial.visible
      );
      // Dim the photo being control-point georeferenced so the reference
      // shows through while picking.
      layer.setOpacity(georefId === aerial.id ? Math.min(0.6, aerial.opacity) : aerial.opacity);
    }

    // Drop layers whose photo was removed or un-resolved.
    for (const [id, layer] of existing) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        existing.delete(id);
        const baked = bakedRef.current.get(id);
        if (baked) {
          const u = baked.url;
          setTimeout(() => URL.revokeObjectURL(u), 4000);
          bakedRef.current.delete(id);
        }
        bakingRef.current.delete(id);
        imgElCacheRef.current.delete(id);
        fittedRef.current.delete(id);
      }
    }
    map.render();
  }, [aerials, sideSpecs, georef, bakeTick, timelapse]);

  // ---------------------- HKMS flight paths + photo dots ------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const yearChanged = fpYearRef.current !== flightPaths?.year;
    fpYearRef.current = flightPaths?.year ?? null;

    if (!flightPaths?.enabled) {
      for (const ref of [fpArcsRef, fpPointsRef, fpSelRef]) {
        if (ref.current) {
          map.removeLayer(ref.current);
          ref.current = null;
        }
      }
      fpSelFeatureRef.current = null;
      setSelectedFlight(null);
      return;
    }

    if (!fpArcsRef.current) {
      // Flight routes: one request per year (a few hundred lines).
      const arcSource = new VectorSource({
        loader: async () => {
          try {
            const json = await (await fetch(flightQueryUrl(1, fpYearRef.current))).json();
            arcSource.addFeatures(
              new EsriJSON().readFeatures(json, {
                dataProjection: 'EPSG:3857',
                featureProjection: 'EPSG:3857',
              })
            );
          } catch { /* retried on next refresh */ }
        },
      });
      fpArcsRef.current = new VectorLayer({ source: arcSource, style: FP_ARC_STYLE, zIndex: 26 });
      map.addLayer(fpArcsRef.current);

      // Photo centres: per-view bbox (60k+ per year territory-wide).
      const ptSource = new VectorSource({
        strategy: bboxStrategy,
        loader: async (extent) => {
          try {
            const json = await (await fetch(flightQueryUrl(0, fpYearRef.current, extent))).json();
            const feats = new EsriJSON().readFeatures(json, {
              dataProjection: 'EPSG:3857',
              featureProjection: 'EPSG:3857',
            });
            const seen = new Set(ptSource.getFeatures().map((f) => f.get('PHOTONO')));
            ptSource.addFeatures(feats.filter((f) => !seen.has(f.get('PHOTONO'))));
          } catch { /* retried on next pan/zoom */ }
        },
      });
      fpPointsRef.current = new VectorLayer({
        source: ptSource,
        style: FP_POINT_STYLE,
        zIndex: 27,
        maxResolution: 10, // ≈ 1:40 000 — keeps per-box counts sane
      });
      map.addLayer(fpPointsRef.current);

      fpSelRef.current = new VectorLayer({ source: new VectorSource(), zIndex: 28 });
      map.addLayer(fpSelRef.current);
    } else if (yearChanged) {
      fpArcsRef.current.getSource().refresh();
      fpPointsRef.current.getSource().refresh();
      fpSelRef.current.getSource().clear();
      fpSelFeatureRef.current = null;
      setSelectedFlight(null);
    }
  }, [flightPaths]);

  // ----------------------- photo bounding-box outlines --------------------
  // Dashed rectangles of each photo's BASE HKMS bounding box (per-photo
  // "Show bounding box" toggle) so the image can be oriented against it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const withBbox = aerials.filter((a) => a.showBbox && a.extent);
    if (!withBbox.length) {
      if (bboxLayerRef.current) {
        map.removeLayer(bboxLayerRef.current);
        bboxLayerRef.current = null;
      }
      return;
    }
    if (!bboxLayerRef.current) {
      bboxLayerRef.current = new VectorLayer({ source: new VectorSource(), zIndex: 30 });
      map.addLayer(bboxLayerRef.current);
    }
    const source = bboxLayerRef.current.getSource();
    source.clear();
    for (const a of withBbox) {
      const [minx, miny, maxx, maxy] = a.extent;
      const ring = [
        [minx, miny],
        [maxx, miny],
        [maxx, maxy],
        [minx, maxy],
        [minx, miny],
      ].map(coord2326To3857);
      const feat = new Feature(new Polygon([ring]));
      feat.setStyle(bboxStyle(a.photono ?? stripExtension(a.filename)));
      source.addFeature(feat);
    }
  }, [aerials]);

  // ------------------------------ vector layers ---------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = vectorLayersRef.current;
    const wanted = new Set();

    for (const vector of vectors) {
      wanted.add(vector.id);
      let layer = existing.get(vector.id);
      if (!layer) {
        const features = new GeoJSON().readFeatures(vector.geojson, {
          dataProjection: vector.dataProjection,
          featureProjection: 'EPSG:3857',
        });
        layer = new VectorLayer({
          source: new VectorSource({ features }),
          zIndex: 20,
        });
        map.addLayer(layer);
        existing.set(vector.id, layer);
        const extent = layer.getSource().getExtent();
        if (extent && isFinite(extent[0])) {
          map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 18 });
        }
      }
      layer.setVisible(vector.visible);
      layer.setStyle(buildStyle(vector.style));
    }

    for (const [id, layer] of existing) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        existing.delete(id);
      }
    }
  }, [vectors]);

  // ------------------------ control-point markers -------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!georef) {
      if (cpLayerRef.current) {
        map.removeLayer(cpLayerRef.current);
        cpLayerRef.current = null;
      }
      map.getViewport().style.cursor = '';
      return;
    }
    map.getViewport().style.cursor = 'crosshair';

    const features = [];
    georef.pairs.forEach((p, i) => {
      const src = new Feature(new Point(coord2326To3857(p.src)));
      src.setStyle(CP_SRC_STYLE(String(i + 1)));
      const dst = new Feature(new Point(coord2326To3857(p.dst)));
      dst.setStyle(CP_DST_STYLE(`${i + 1}′`));
      const line = new Feature(
        new LineString([coord2326To3857(p.src), coord2326To3857(p.dst)])
      );
      line.setStyle(CP_LINE_STYLE);
      features.push(line, src, dst);
    });
    if (georef.draft) {
      const draft = new Feature(new Point(coord2326To3857(georef.draft)));
      draft.setStyle(CP_DRAFT_STYLE);
      features.push(draft);
    }

    if (!cpLayerRef.current) {
      cpLayerRef.current = new VectorLayer({ source: new VectorSource(), zIndex: 40 });
      map.addLayer(cpLayerRef.current);
    }
    const source = cpLayerRef.current.getSource();
    source.clear();
    source.addFeatures(features);
  }, [georef]);

  // ------------------------------- swipe sync -----------------------------
  useEffect(() => {
    mapRef.current?.render();
  }, [swipe.enabled, swipe.position]);

  // ------------------- zoom requests (explicit Zoom button) ---------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zoomRequest) return;
    map.getView().fit(hkExtentTo3857(zoomRequest.extent), {
      padding: [60, 60, 60, 60],
      maxZoom: 19,
    });
  }, [zoomRequest]);

  // ---------------------------- set viewing scale -------------------------
  const applyScale = (denom) => {
    const map = mapRef.current;
    const n = Number(denom);
    if (!map || !Number.isFinite(n) || n <= 0) return;
    const view = map.getView();
    view.setResolution(scaleToResolution(n, view.getCenter()));
    setScaleInput('');
  };

  // ------------------------- swipe handle dragging ------------------------
  const startDrag = (downEvt) => {
    downEvt.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const move = (e) => {
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      onSwipePosition(Math.min(0.98, Math.max(0.02, x / rect.width)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  // ------------------------------ overlays --------------------------------
  const sideLabel = (spec) => {
    if (!spec || spec === 'basemap') return BASEMAP_LABELS[basemapKey] ?? 'Basemap';
    if (spec.startsWith('ortho:')) {
      const label = orthoLabel(spec.slice(6));
      return `CEDD Ortho ${label ? label.replace(/^Year\s*/, '') : spec.slice(6)}`;
    }
    if (spec.startsWith('aerial:')) {
      const a = aerials.find((x) => x.id === spec.slice(7));
      return a ? stripExtension(a.filename) : 'Photo';
    }
    return spec;
  };

  const liveFit = georef && georef.pairs.length >= 2 ? solveHelmert(georef.pairs) : null;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div ref={mapElRef} className="h-full w-full bg-slate-800" />

      {/* Swipe divider + handle + side labels (hidden during timelapse) */}
      {swipe.enabled && !timelapse?.active && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]"
            style={{ left: `${swipe.position * 100}%` }}
          />
          <button
            onPointerDown={startDrag}
            title="Drag to compare"
            className="absolute top-1/2 z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg select-none"
            style={{ left: `${swipe.position * 100}%` }}
          >
            ⟨⟩
          </button>
          <span className="absolute top-4 left-4 z-20 max-w-[45%] truncate rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-white">
            {sideLabel(sideSpecs?.left)}
          </span>
          <span className="absolute top-4 right-4 z-20 max-w-[45%] truncate rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-white">
            {sideLabel(sideSpecs?.right)}
          </span>
        </>
      )}

      {/* Control-point georeferencing banner */}
      {georef && (
        <div className="absolute top-4 left-1/2 z-30 w-[min(560px,92%)] -translate-x-1/2 rounded-lg border border-emerald-600/60 bg-slate-900/95 p-3 shadow-xl">
          <p className="text-xs font-semibold text-emerald-300">
            🎯 Control-point georeferencing — {georefAerial ? georefAerial.filename : ''}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {georef.draft ? (
              <>
                Now click that feature’s <b className="text-emerald-300">true position on the reference</b> (ortho/basemap).
              </>
            ) : (
              <>
                Click a recognisable feature <b className="text-orange-300">on the photo</b> — building corners, road
                junctions, sports pitches work best.
              </>
            )}{' '}
            Pairs: {georef.pairs.length} (need ≥ 3)
            {liveFit && (
              <span className="text-slate-400">
                {' '}· fit RMS {liveFit.rms.toFixed(2)} m · rot {liveFit.rotation.toFixed(2)}° · scale ×{liveFit.scale.toFixed(4)}
              </span>
            )}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={onGeorefApply}
              disabled={georef.pairs.length < 3}
              className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply fit
            </button>
            <button
              onClick={onGeorefUndo}
              disabled={georef.pairs.length === 0 && !georef.draft}
              className="rounded-md bg-slate-700 px-3 py-1 text-[11px] text-slate-200 transition hover:bg-slate-600 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={onGeorefClear}
              disabled={georef.pairs.length === 0 && !georef.draft}
              className="rounded-md bg-slate-700 px-3 py-1 text-[11px] text-slate-200 transition hover:bg-slate-600 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              onClick={onGeorefCancel}
              className="ml-auto rounded-md bg-slate-700 px-3 py-1 text-[11px] text-slate-200 transition hover:bg-rose-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clicked flight-path photo details (like the HKMS product popup) */}
      {selectedFlight && (
        <div className="absolute bottom-10 left-4 z-30 rounded-lg border border-orange-500/50 bg-slate-900/95 px-3 py-2 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold text-orange-300">
              📷 {selectedFlight.photono}
            </p>
            <button
              onClick={() => {
                setSelectedFlight(null);
                fpSelRef.current?.getSource().clear();
              }}
              className="text-xs text-slate-400 hover:text-white"
              title="Close"
            >
              ✕
            </button>
          </div>
          {selectedFlight.loading ? (
            <p className="mt-0.5 text-[11px] text-slate-400">Loading footprint…</p>
          ) : selectedFlight.missing ? (
            <p className="mt-0.5 text-[11px] text-amber-300">No footprint found for this photo.</p>
          ) : (
            <>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                {selectedFlight.date ? `Flight ${selectedFlight.date}` : `Year ${selectedFlight.year}`}
                {selectedFlight.scale ? ` · 1:${selectedFlight.scale}` : ''}
                {selectedFlight.flyingHt ? ` · ${selectedFlight.flyingHt} ft` : ''}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <a
                  href={dapDownloadUrl(selectedFlight.photono)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-orange-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-orange-500"
                  title="Open the official CSDI open-data page to download this photo (JPEG)"
                >
                  ⬇ Download
                </a>
                <button
                  onClick={() => addFileInputRef.current?.click()}
                  className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-sky-500"
                  title="Add the downloaded photo file — it auto-georeferences by its sheet name"
                >
                  ➕ Add to map
                </button>
              </div>
              <span className="mt-1 block text-[10px] text-slate-500">
                Download opens the official HKMS page (bot-check there); then add
                the {selectedFlight.photono}.jpg file to place it.
              </span>
            </>
          )}
        </div>
      )}

      {/* Hidden input for "Add to map" — reuses the normal upload pipeline. */}
      <input
        ref={addFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onImageFiles?.([...e.target.files]);
          e.target.value = '';
        }}
      />

      {/* Timelapse year caption */}
      {timelapse?.active && timelapse.caption && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-slate-900/85 px-5 py-2 text-center shadow-xl">
          <p className="text-2xl font-bold tracking-wide text-white tabular-nums">
            {timelapse.caption}
          </p>
          {timelapse.subCaption && (
            <p className="text-[11px] text-slate-300">{timelapse.subCaption}</p>
          )}
        </div>
      )}

      {/* Viewing-scale control */}
      <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-md bg-slate-900/85 px-2 py-1 font-mono text-[11px] text-slate-100 shadow">
        <span className="text-slate-400">Scale 1:</span>
        <input
          type="text"
          inputMode="numeric"
          value={scaleInput}
          onChange={(e) => setScaleInput(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && scaleInput) applyScale(scaleInput);
          }}
          placeholder={mapScale ? mapScale.toLocaleString() : '—'}
          className="w-20 rounded border border-slate-700 bg-slate-950/70 px-1 py-0.5 text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
        />
        <button
          onClick={() => scaleInput && applyScale(scaleInput)}
          className="rounded bg-sky-600 px-1.5 py-0.5 text-white transition hover:bg-sky-500"
          title="Zoom to this scale"
        >
          Go
        </button>
      </div>

      {/* Dual-CRS mouse position readout */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-md bg-slate-900/85 px-4 py-1.5 font-mono text-[11px] text-slate-100 shadow">
        {readout ? (
          <span>
            WGS84 {readout.wgs84} <span className="mx-2 text-slate-500">|</span> HK1980 {readout.hk1980}
          </span>
        ) : (
          <span className="text-slate-400">Move the cursor over the map for coordinates</span>
        )}
      </div>
    </div>
  );
}

// Screen resolution: 96 dpi → 1 px = 0.0254/96 m on paper.
const M_PER_PIXEL = 0.0254 / 96;

/** Map view resolution (EPSG:3857) → 1:N scale denominator at `center`. */
function resolutionToScale(resolution, center) {
  if (!resolution || !center) return null;
  const groundRes = getPointResolution('EPSG:3857', resolution, center); // true m/px
  return Math.round(groundRes / M_PER_PIXEL);
}

/** 1:N scale denominator → the view resolution (EPSG:3857) at `center`. */
function scaleToResolution(denom, center) {
  const groundRes = denom * M_PER_PIXEL; // desired true m/px on the ground
  // Undo the point-resolution scaling: for 3857, viewRes ≈ groundRes / cos(lat).
  const lat = (toLonLat(center)[1] * Math.PI) / 180;
  return groundRes / Math.cos(lat);
}

/** Decode an aerial photo's file once and cache the Image element. */
function loadAerialImage(cache, aerial) {
  const cached = cache.get(aerial.id);
  if (cached && cached.url === aerial.url) return cached.promise;
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = aerial.url;
  });
  cache.set(aerial.id, { url: aerial.url, promise });
  return promise;
}
