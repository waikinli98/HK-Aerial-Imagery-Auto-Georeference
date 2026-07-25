/**
 * Georeferencing adjustment math.
 *
 * Every aerial photo carries an `adjust` on top of its base HKMS bounding box:
 *
 *     { dx, dy, scale, rotation }
 *
 * meaning: rotate by `rotation` degrees (counter-clockwise on the map) and
 * scale by `scale`, both about the BASE extent's centre, then translate by
 * (dx, dy) metres — all in EPSG:2326. This is a 4-parameter similarity
 * (Helmert) transform, the same model ArcGIS uses for 1st-order
 * control-point georeferencing with uniform scale.
 *
 * Also here: the least-squares Helmert solver for the control-point tool and
 * the canvas "bake" that produces a rotated raster OpenLayers can display
 * (ImageStatic only supports axis-aligned extents, so rotation is baked into
 * the pixels and the extent becomes the rotated footprint's bbox).
 */

export const DEFAULT_ADJUST = { dx: 0, dy: 0, scale: 1, rotation: 0 };

export function isIdentityAdjust(a) {
  return !a || (a.dx === 0 && a.dy === 0 && a.scale === 1 && a.rotation === 0);
}

const centerOf = (e) => [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];

/** Apply the full adjust to one EPSG:2326 point of the base image footprint. */
export function applyAdjustToPoint(pt, baseExtent, adjust) {
  const [cx, cy] = centerOf(baseExtent);
  const th = (adjust.rotation * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const x = pt[0] - cx;
  const y = pt[1] - cy;
  const s = adjust.scale;
  return [
    cx + s * (x * cos - y * sin) + adjust.dx,
    cy + s * (x * sin + y * cos) + adjust.dy,
  ];
}

/** Adjusted extent when there is no rotation (plain scale-about-centre + shift). */
export function adjustExtentNoRotation(extent, adjust) {
  const [cx, cy] = centerOf(extent);
  const hw = ((extent[2] - extent[0]) / 2) * adjust.scale;
  const hh = ((extent[3] - extent[1]) / 2) * adjust.scale;
  return [
    cx - hw + adjust.dx,
    cy - hh + adjust.dy,
    cx + hw + adjust.dx,
    cy + hh + adjust.dy,
  ];
}

/** Axis-aligned bbox of the (possibly rotated) adjusted image footprint. */
export function adjustedFootprintExtent(extent, adjust) {
  const corners = [
    [extent[0], extent[1]],
    [extent[2], extent[1]],
    [extent[2], extent[3]],
    [extent[0], extent[3]],
  ].map((p) => applyAdjustToPoint(p, extent, adjust));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Bake a rotated/scaled photo into a new canvas so it can be displayed as an
 * axis-aligned ImageStatic. Returns { url (blob URL — caller must revoke),
 * extent (EPSG:2326 bbox of the rotated footprint) }.
 *
 * `orientation` (0/90/180/270, CCW) rotates the image CONTENT within the
 * bounding box before any adjustment — for scans that were digitised sideways
 * or upside-down relative to grid north. At 90/270 the content's width spans
 * the box's height, so the pre-rotation draw size is swapped.
 */
export async function bakeAdjustedImage(img, extent, adjust, orientation = 0) {
  const foot = adjustedFootprintExtent(extent, adjust);
  const swap = orientation === 90 || orientation === 270;
  // Ground size the (scaled) box occupies, and the content rect that fills it
  // once rotated by `orientation`.
  const gw = (extent[2] - extent[0]) * adjust.scale;
  const gh = (extent[3] - extent[1]) * adjust.scale;
  const contentW = swap ? gh : gw;
  const contentH = swap ? gw : gh;
  // Metres per canvas pixel, preserving the source resolution.
  const mpp = contentW / img.naturalWidth;
  let cw = Math.round((foot[2] - foot[0]) / mpp);
  let ch = Math.round((foot[3] - foot[1]) / mpp);
  const MAX = 8192; // stay well under canvas size limits for big scans
  const f = Math.max(cw, ch) > MAX ? MAX / Math.max(cw, ch) : 1;
  cw = Math.max(1, Math.round(cw * f));
  ch = Math.max(1, Math.round(ch * f));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // The footprint's centre is the adjusted image centre (the transform
  // rotates/scales about the base centre then translates it there).
  ctx.translate(cw / 2, ch / 2);
  // Map rotation is CCW with y up; canvas y points down, which mirrors the
  // sense of rotation, hence the negative angle.
  ctx.rotate((-(adjust.rotation + orientation) * Math.PI) / 180);
  const dw = (contentW * f) / mpp;
  const dh = (contentH * f) / mpp;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { url: URL.createObjectURL(blob), extent: foot };
}

/**
 * Derive the display fit from a photo's flight-line azimuth (° clockwise from
 * north). HKMS scans are stored flight-direction-up, and the served bounding
 * box is the axis-aligned ENVELOPE of the true (rotated) footprint, so:
 *
 *  - content must rotate CCW by the azimuth to bring north up;
 *  - we split that into a cardinal `orientation` (0/90/180/270) plus a
 *    residual `rotation` (−45…45°);
 *  - a non-cardinal residual r means the true footprint is a square rotated r
 *    inside the envelope — shrink by 1/(|cos r|+|sin r|) so it fits exactly.
 *
 * Returns { orientation, rotation, scale } or null when no azimuth is known.
 */
export function fitFromAzimuth(angle) {
  if (angle == null || !Number.isFinite(angle)) return null;
  const a = ((angle % 360) + 360) % 360;
  const steps = Math.round(a / 90);
  const rotation = a - steps * 90; // residual, −45…45
  const rad = (rotation * Math.PI) / 180;
  const scale = 1 / (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
  return {
    orientation: ((steps % 4) + 4) % 4 * 90,
    rotation: Math.abs(rotation) < 0.05 ? 0 : rotation,
    scale: Math.abs(rotation) < 0.05 ? 1 : scale,
  };
}

/**
 * Full auto-fit combining the flight azimuth with the decoded image's aspect
 * ratio vs the bounding box's aspect:
 *
 *  - aspect ≈ box aspect      → the file is already a north-up product
 *    (modern HKMS downloads carry an annotation frame + EXIF rotation): no
 *    content rotation needed;
 *  - aspect ≈ transposed box  → the frame is stored a quarter-turn off: turn
 *    it by the azimuth's cardinal;
 *  - square-ish (old film)    → scans are flight-direction-up: apply the full
 *    azimuth fit (cardinal + residual + envelope shrink).
 *
 * `size` = [width, height] px of the decoded image (may be null → azimuth only).
 */
export function autoFit(angle, size, extent) {
  const az = fitFromAzimuth(angle);
  if (!size || !extent) return az;
  const imgAspect = size[0] / size[1];
  const boxAspect = (extent[2] - extent[0]) / (extent[3] - extent[1]);
  const dSame = Math.abs(Math.log(imgAspect / boxAspect));
  const dSwap = Math.abs(Math.log(1 / imgAspect / boxAspect));
  const MARGIN = 0.08; // tie margin — square film falls through to azimuth
  if (dSame + MARGIN < dSwap) {
    return { orientation: 0, rotation: 0, scale: 1 };
  }
  if (dSwap + MARGIN < dSame) {
    const quarter = az && (az.orientation === 90 || az.orientation === 270) ? az.orientation : 90;
    return { orientation: quarter, rotation: 0, scale: 1 };
  }
  return az;
}

/**
 * Least-squares 2D similarity (4-parameter Helmert) fit from control-point
 * pairs `[{ src: [x,y], dst: [x,y] }, …]` (EPSG:2326 metres):
 *
 *     dst ≈ s · R(θ) · src + t
 *
 * Returns { scale, rotation (deg CCW), tx, ty, rms, residuals } or null if
 * fewer than 2 pairs / degenerate geometry.
 */
export function solveHelmert(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (const p of pairs) {
    sx += p.src[0]; sy += p.src[1];
    dx += p.dst[0]; dy += p.dst[1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;

  let saa = 0, sbb = 0, ss = 0;
  for (const p of pairs) {
    const xs = p.src[0] - sx, ys = p.src[1] - sy;
    const xd = p.dst[0] - dx, yd = p.dst[1] - dy;
    saa += xs * xd + ys * yd; // Σ src·dst   (cosine part)
    sbb += xs * yd - ys * xd; // Σ src×dst   (sine part)
    ss += xs * xs + ys * ys;
  }
  if (ss === 0) return null; // all source points coincide
  const a = saa / ss;
  const b = sbb / ss;
  const scale = Math.hypot(a, b);
  if (scale === 0) return null;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const tx = dx - (a * sx - b * sy);
  const ty = dy - (b * sx + a * sy);

  const residuals = pairs.map((p) => {
    const px = a * p.src[0] - b * p.src[1] + tx;
    const py = b * p.src[0] + a * p.src[1] + ty;
    return Math.hypot(px - p.dst[0], py - p.dst[1]);
  });
  const rms = Math.sqrt(residuals.reduce((acc, r) => acc + r * r, 0) / n);
  return { scale, rotation, tx, ty, rms, residuals };
}

/**
 * Compose a Helmert fit (absolute map-space transform H) onto an existing
 * adjust A, returning the adjust for H∘A — i.e. control points were picked on
 * the photo AS CURRENTLY DISPLAYED, so the new fit applies on top.
 */
export function composeAdjust(current, helmert, baseExtent) {
  const [cx, cy] = centerOf(baseExtent);
  const thH = (helmert.rotation * Math.PI) / 180;
  const cos = Math.cos(thH);
  const sin = Math.sin(thH);
  // q = c0 + d_current  (where the base centre currently sits)
  const qx = cx + current.dx;
  const qy = cy + current.dy;
  // d_total = s_h·R_h·q + t_h − c0
  const s = helmert.scale;
  return {
    scale: current.scale * helmert.scale,
    rotation: current.rotation + helmert.rotation,
    dx: s * (qx * cos - qy * sin) + helmert.tx - cx,
    dy: s * (qx * sin + qy * cos) + helmert.ty - cy,
  };
}
