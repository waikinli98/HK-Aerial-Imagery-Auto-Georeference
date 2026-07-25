# -*- coding: utf-8 -*-
"""
HKMS Aerial Photo Georeferencer — ArcGIS Pro Python toolbox.

Auto-georeferences HKMS 2.0 aerial photo downloads (e.g. 2019_E067799C.jpg,
1995_73576.jpeg) by querying the HKMS FlightPaths index for each photo's
footprint and flight azimuth, then writing a world file (.jgw) + .prj
(Hong Kong 1980 Grid, EPSG:2326) next to each image. After running, simply
add the photos to a map — ArcGIS reads the world files and they land
georeferenced, correctly rotated for flight direction. Fine-tune (if needed)
with the normal Georeference tab against the CEDD ortho of the nearest year.

The world-file affine encodes the same auto-orientation logic proven in the
companion web app:
  - image aspect ≈ box aspect      -> content already north-up (no rotation)
  - image aspect transposed        -> quarter-turn from the flight azimuth
  - square frame (old film scans)  -> full azimuth rotation; the served box is
    the rotated footprint's envelope, so the true frame side is
    envelope / (|cos r| + |sin r|).

NOTE: ArcGIS reads RAW JPEG pixels and ignores EXIF rotation, which is exactly
what the affine below assumes (verified against real 2019/2021/1995 downloads).
"""

import json
import math
import os
import re
import urllib.parse
import urllib.request

FLIGHTPATHS_QUERY = (
    "https://api.hkmapservice.gov.hk/oss/services/OneStop/FlightPaths/"
    "MapServer/2/query"
)
# Public map-API key embedded in the HKMS 2.0 site.
HKMS_KEY = "dd970799919f49f3929ea6b2b5d47cf5"

HK1980_WKT = (
    'PROJCS["Hong_Kong_1980_Grid",GEOGCS["GCS_Hong_Kong_1980",'
    'DATUM["D_Hong_Kong_1980",SPHEROID["International_1924",6378388.0,297.0]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",836694.05],'
    'PARAMETER["False_Northing",819069.8],'
    'PARAMETER["Central_Meridian",114.1785555555556],'
    'PARAMETER["Scale_Factor",1.0],'
    'PARAMETER["Latitude_Of_Origin",22.31213333333334],'
    'UNIT["Meter",1.0]]'
)


# --------------------------- core (arcpy-free) -----------------------------

def extract_photono(filename):
    """'2019_E067799C.jpg' -> 'E067799C'; '1995_73576.jpeg' -> '73576'."""
    up = os.path.basename(filename).upper()
    m = re.search(r"([A-Z]{1,2}\d{5,6}[A-Z]?)", up)
    if m:
        return m.group(1)
    nums = re.findall(r"(?<!\d)\d{4,6}(?!\d)", up)
    non_year = [n for n in nums if not re.match(r"^(19|20)\d\d$", n)]
    return non_year[-1] if non_year else None


def lookup_photo(photono):
    """Query the HKMS index: returns (extent [minx,miny,maxx,maxy], angle) or None."""
    params = urllib.parse.urlencode({
        "where": "PHOTONO='%s'" % photono.replace("'", ""),
        "outFields": "PHOTONO,YEARFLIGHT,ANGLE",
        "returnGeometry": "true",
        "outSR": "2326",
        "f": "json",
        "key": HKMS_KEY,
    })
    with urllib.request.urlopen(FLIGHTPATHS_QUERY + "?" + params, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    feats = data.get("features") or []
    if not feats:
        return None
    rings = feats[0].get("geometry", {}).get("rings") or []
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    if not xs:
        return None
    extent = [min(xs), min(ys), max(xs), max(ys)]
    angle = feats[0].get("attributes", {}).get("ANGLE")
    return extent, (angle if isinstance(angle, (int, float)) else None)


def jpeg_size(path):
    """Raw pixel size (w, h) from JPEG headers (EXIF rotation ignored)."""
    with open(path, "rb") as f:
        data = f.read(200000)
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h = int.from_bytes(data[i + 5:i + 7], "big")
            w = int.from_bytes(data[i + 7:i + 9], "big")
            return w, h
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    raise ValueError("could not read JPEG dimensions")


def png_size(path):
    """Raw pixel size (w, h) from a PNG IHDR chunk."""
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def read_image_size(path):
    """
    Raw pixel size (w, h), EXIF rotation ignored — ArcGIS/GDAL read raw pixels,
    so the affine must be built for the stored orientation. Uses Pillow when
    available (JPEG/PNG/TIFF), else a header parser for JPEG/PNG.
    """
    try:
        from PIL import Image  # ArcGIS Pro's conda env ships Pillow
        with Image.open(path) as im:
            return im.size  # (width, height), pre-EXIF-transpose
    except Exception:
        pass
    ext = os.path.splitext(path)[1].lower()
    if ext in (".jpg", ".jpeg", ".jpe"):
        return jpeg_size(path)
    if ext == ".png":
        return png_size(path)
    raise ValueError("cannot read dimensions for %s (install Pillow for TIFF)" % ext)


def world_file_paths(image_path):
    """
    Sidecar world-file paths for a raster: the generic ``.wld`` (read by
    ArcGIS/GDAL for any format) plus the format-specific one (``.jgw`` /
    ``.tfw`` / ``.pgw``) for maximum compatibility.
    """
    base, ext = os.path.splitext(image_path)
    specific = {
        ".jpg": ".jgw", ".jpeg": ".jgw", ".jpe": ".jgw",
        ".tif": ".tfw", ".tiff": ".tfw",
        ".png": ".pgw",
    }.get(ext.lower())
    paths = [base + ".wld"]
    if specific:
        paths.append(base + specific)
    return paths


def content_rotation(angle, size, extent):
    """CCW degrees to rotate the RAW content so north is up (see module doc)."""
    w, h = size
    bw, bh = extent[2] - extent[0], extent[3] - extent[1]
    img_aspect, box_aspect = w / h, bw / bh
    d_same = abs(math.log(img_aspect / box_aspect))
    d_swap = abs(math.log((1 / img_aspect) / box_aspect))
    margin = 0.08
    az = ((angle % 360) + 360) % 360 if angle is not None else None
    if d_same + margin < d_swap:
        return 0.0
    if d_swap + margin < d_same:
        if az is not None and round(az / 90) % 4 * 90 in (90, 270):
            return float(round(az / 90) % 4 * 90)
        return 90.0
    return float(az) if az is not None else 0.0


def world_file_terms(extent, size, theta_ccw_deg):
    """A,D,B,E,C,F for a frame rotated theta CCW about the box centre."""
    w, h = size
    minx, miny, maxx, maxy = extent
    th = math.radians(theta_ccw_deg)
    cos_t, sin_t = math.cos(th), math.sin(th)
    # True frame side: the served box is the rotated frame's envelope.
    env_w, env_h = maxx - minx, maxy - miny
    fw = env_w / (abs(cos_t) + abs(sin_t) * (h / w)) if w else env_w
    # For quarter turns / no turn this reduces to the plain box mapping:
    if theta_ccw_deg % 180 == 0:
        px, py = env_w / w, env_h / h
    elif theta_ccw_deg % 90 == 0:
        px, py = env_h / w, env_w / h
    else:
        # square film: uniform pixel size from the shrunken frame side
        s = env_w / (abs(cos_t) + abs(sin_t))
        px = py = s / w
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    # ground = centre + R(theta) . (dc*px, -dr*py), dc/dr from the raw centre
    A = px * cos_t
    B = py * sin_t
    D = px * sin_t
    E = -py * cos_t
    dc0, dr0 = 0.5 - w / 2, 0.5 - h / 2
    C = cx + A * dc0 + B * dr0
    F = cy + D * dc0 + E * dr0
    return A, D, B, E, C, F


def write_sidecars(image_path, extent, angle):
    size = read_image_size(image_path)
    theta = content_rotation(angle, size, extent)
    terms = world_file_terms(extent, size, theta)
    body = "\n".join("%.10f" % v for v in terms) + "\n"
    for wf in world_file_paths(image_path):
        with open(wf, "w") as f:
            f.write(body)
    # CRS sidecar (GDAL/ArcGIS read <name>.prj for world-file rasters).
    with open(os.path.splitext(image_path)[0] + ".prj", "w") as f:
        f.write(HK1980_WKT)
    # Drop any stale ArcGIS georeferencing override so the world file wins.
    aux = image_path + ".aux.xml"
    if os.path.exists(aux):
        os.remove(aux)
    return theta, size


# ------------------------------ toolbox UI ---------------------------------

class Toolbox(object):
    def __init__(self):
        self.label = "HKMS Aerial Photo Georeferencer"
        self.alias = "hkmsgeoref"
        self.tools = [GeoreferencePhotos]


class GeoreferencePhotos(object):
    def __init__(self):
        self.label = "Georeference HKMS Photos (world files)"
        self.description = (
            "Looks up each photo's bounding box + flight azimuth in the HKMS "
            "2.0 index and writes .jgw/.prj sidecars (EPSG:2326) so the "
            "photos load georeferenced and correctly oriented."
        )

    def getParameterInfo(self):
        import arcpy
        photos = arcpy.Parameter(
            displayName="Aerial photo files (named like 2019_E067799C.jpg)",
            name="photos",
            datatype="DEFile",
            parameterType="Required",
            direction="Input",
            multiValue=True,
        )
        photos.filter.list = ["jpg", "jpeg", "png"]
        add = arcpy.Parameter(
            displayName="Add georeferenced photos to the current map",
            name="add_to_map",
            datatype="GPBoolean",
            parameterType="Optional",
            direction="Input",
        )
        add.value = True
        return [photos, add]

    def execute(self, parameters, messages):
        import arcpy
        files = [str(v) for v in parameters[0].values]
        add_to_map = bool(parameters[1].value)
        ok = 0
        not_found = []
        for path in files:
            photono = extract_photono(path)
            if not photono:
                messages.addWarningMessage("%s: no Photo No. in file name" % path)
                continue
            try:
                hit = lookup_photo(photono)
            except Exception as exc:  # network etc.
                messages.addWarningMessage("%s: HKMS lookup failed (%s)" % (photono, exc))
                continue
            if not hit:
                not_found.append(photono)
                messages.addWarningMessage(
                    "%s: not in the HKMS index — georeference it manually in Pro" % photono
                )
                continue
            extent, angle = hit
            try:
                theta, size = write_sidecars(path, extent, angle)
            except Exception as exc:
                messages.addWarningMessage("%s: could not write sidecars (%s)" % (path, exc))
                continue
            ok += 1
            messages.addMessage(
                "%s: %dx%d px, azimuth %s -> content rotated %.1f deg CCW, "
                "placed at [%.1f, %.1f, %.1f, %.1f] EPSG:2326"
                % (photono, size[0], size[1],
                   ("%.1f" % angle) if angle is not None else "n/a",
                   theta, extent[0], extent[1], extent[2], extent[3])
            )
            if add_to_map:
                try:
                    aprx = arcpy.mp.ArcGISProject("CURRENT")
                    aprx.activeMap.addDataFromPath(path)
                except Exception:
                    pass  # e.g. run outside a map view
        messages.addMessage("Done - %d of %d photo(s) georeferenced." % (ok, len(files)))
        if not_found:
            messages.addMessage("Not found in index: %s" % ", ".join(not_found))
