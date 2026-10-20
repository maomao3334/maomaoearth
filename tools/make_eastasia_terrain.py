"""下载东亚 AWS Terrarium z7 高程瓦片，生成 0.02° 东亚地形高度栅格与阴影图。"""
import io
import json
import math
import os
import shutil
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

Z = 7
WEST, SOUTH, EAST, NORTH = 55.0, 0.0, 150.0, 60.0
RES = 0.02
W = int(round((EAST - WEST) / RES))   # 4750
H = int(round((NORTH - SOUTH) / RES))  # 3000
ROOT = r"G:\sh\local-earth\data\public\dem"
TMP = os.path.join(ROOT, "_terrarium_z7_ea")
OUT_BIN = os.path.join(ROOT, "eastasia-terrain.bin")
OUT_JSON = os.path.join(ROOT, "eastasia-terrain.json")
OUT_PNG = os.path.join(ROOT, "eastasia-hillshade.png")


def merc_y(lat):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0


def inv_merc_lat(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y))))


def download(x, y):
    path = os.path.join(TMP, f"{x}_{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return path
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "local-earth-terrain/1.0"})
            data = urllib.request.urlopen(req, timeout=60).read()
            if len(data) > 500:
                with open(path, "wb") as f:
                    f.write(data)
                return path
        except Exception:  # noqa: BLE001
            pass
    try:
        subprocess.run(
            ["curl.exe", "-L", "-4", "--retry", "5", "--retry-delay", "2",
             "--connect-timeout", "20", "-s", "-o", path, url],
            timeout=180, check=False,
        )
        if os.path.exists(path) and os.path.getsize(path) > 500:
            return path
    except Exception:  # noqa: BLE001
        pass
    return None


def decode(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    return (a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0).astype(np.int16)


def main():
    os.makedirs(TMP, exist_ok=True)
    n = 2 ** Z
    x0 = max(0, math.floor((WEST + 180.0) / 360.0 * n))
    x1 = min(n - 1, math.floor((EAST + 180.0) / 360.0 * n))
    y0 = max(0, math.floor(merc_y(NORTH) * n))
    y1 = min(n - 1, math.floor(merc_y(SOUTH) * n))
    tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(f"bbox {WEST},{SOUTH}->{EAST},{NORTH}; grid {W}x{H}; tiles z{Z} x{x0}-{x1} y{y0}-{y1} count {len(tiles)}", flush=True)

    done = 0
    failed = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(download, x, y): (x, y) for x, y in tiles}
        for fut in as_completed(futures):
            if not fut.result():
                failed.append(futures[fut])
            done += 1
            if done % 200 == 0 or done == len(tiles):
                print(f"downloaded {done}/{len(tiles)} (failed {len(failed)})", flush=True)
    if failed:
        print(f"retrying {len(failed)}", flush=True)
        for x, y in failed:
            download(x, y)

    grid = np.zeros((H, W), dtype=np.int16)
    global_px = 256.0 * n
    for idx, (tx, ty) in enumerate(tiles, 1):
        path = os.path.join(TMP, f"{tx}_{ty}.png")
        if not (os.path.exists(path) and os.path.getsize(path) > 500):
            continue
        arr = decode(path)
        lon0 = tx / n * 360.0 - 180.0
        lon1 = (tx + 1) / n * 360.0 - 180.0
        lat_top = inv_merc_lat(ty / n)
        lat_bot = inv_merc_lat((ty + 1) / n)
        i_lo = max(0, int(math.ceil((lon0 - WEST) / RES - 1e-9)))
        i_hi = min(W - 1, int(math.floor((lon1 - WEST) / RES + 1e-9)))
        j_lo = max(0, int(math.ceil((NORTH - lat_top) / RES - 1e-9)))
        j_hi = min(H - 1, int(math.floor((NORTH - lat_bot) / RES + 1e-9)))
        if i_lo > i_hi or j_lo > j_hi:
            continue
        lons = WEST + np.arange(i_lo, i_hi + 1, dtype=np.float64) * RES
        px = (lons + 180.0) / 360.0 * global_px
        txpix = np.clip(np.round(px - tx * 256.0).astype(np.int32), 0, 255)
        lats = NORTH - np.arange(j_lo, j_hi + 1, dtype=np.float64) * RES
        rad = np.radians(lats)
        yg = (1.0 - np.log(np.tan(rad) + 1.0 / np.cos(rad)) / math.pi) / 2.0
        py = yg * global_px
        typix = np.clip(np.round(py - ty * 256.0).astype(np.int32), 0, 255)
        grid[j_lo:j_hi + 1, i_lo:i_hi + 1] = arr[np.ix_(typix, txpix)]
        if idx % 200 == 0 or idx == len(tiles):
            print(f"sampled {idx}/{len(tiles)}", flush=True)

    grid = np.maximum(grid, 0)
    grid.astype("<i2").tofile(OUT_BIN)
    meta = {
        "name": "East Asia terrain heightmap (0.02 deg)",
        "source": "AWS Terrain Tiles (Terrarium z7), SRTM/ETOPO composite; open data",
        "bbox": [WEST, SOUTH, EAST, NORTH],
        "west": WEST, "south": SOUTH, "east": EAST, "north": NORTH,
        "width": W, "height": H, "resolutionDeg": RES,
        "rowOrder": "north-to-south",
        "scale": 1.0, "offset": 0.0, "dtype": "int16-le",
        "minHeight": int(grid.min()), "maxHeight": int(grid.max()),
        "file": "eastasia-terrain.bin",
        "hillshade": "eastasia-hillshade.png",
        "license": "Open data (AWS Terrain Tiles / Terrarium; SRTM public domain, ETOPO)",
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 阴影图：分块计算梯度降低内存
    hmin, hmax = float(grid.min()), float(grid.max())
    small = np.asarray(Image.fromarray(grid.astype(np.float32), mode="F").resize((2048, int(round(2048 * H / W))), Image.BILINEAR), dtype=np.float32)
    sh, sw = small.shape
    lat_mid = math.radians((SOUTH + NORTH) / 2.0)
    dy = (NORTH - SOUTH) / (sh - 1) * 111132.0
    dx = (EAST - WEST) / (sw - 1) * 111320.0 * math.cos(lat_mid)
    gy, gx = np.gradient(small, dy, dx)
    az = math.radians(315.0)
    alt = math.radians(45.0)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    hs = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
    t = np.clip(small / max(1.0, hmax), 0, 1)
    r = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [80, 120, 160, 200, 248])
    g = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [110, 140, 165, 185, 248])
    b = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [90, 100, 110, 130, 248])
    shade = 0.5 + 0.7 * hs
    rgb = np.stack([np.clip(r * shade, 0, 255), np.clip(g * shade, 0, 255), np.clip(b * shade, 0, 255)], axis=-1)
    water = small <= 0
    rgb[water] = np.array([30, 60, 88], dtype=np.float32)
    rgba = np.dstack([rgb.astype(np.uint8), np.full((sh, sw), 255, dtype=np.uint8)])
    Image.fromarray(rgba, "RGBA").save(OUT_PNG)
    print(f"written {OUT_BIN} {os.path.getsize(OUT_BIN)} B; {OUT_PNG} {os.path.getsize(OUT_PNG)} B; h {int(grid.min())}..{int(grid.max())}", flush=True)
    shutil.rmtree(TMP, ignore_errors=True)
    print("temp tiles removed", flush=True)


if __name__ == "__main__":
    main()
