"""用完整 SRTM 1″（3601×3601）重建示例区地形 + 高精度阴影（供局部近景使用）。"""
import gzip
import json
import math
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC = r"G:\sh\local-earth\data\public\dem\N25E102.hgt.gz"
OUT_DIR = r"G:\sh\local-earth\data\public\dem"
BIN = os.path.join(OUT_DIR, "N25E102-terrain.bin")
JSON_PATH = os.path.join(OUT_DIR, "N25E102-terrain.json")
PNG = os.path.join(OUT_DIR, "N25E102-hillshade.png")

raw = gzip.open(SRC, "rb").read()
n = int(math.sqrt(len(raw) // 2))
print("hgt", n)
dem = np.frombuffer(raw, dtype=">i2").reshape(n, n).astype(np.float32)
dem[dem < -1000] = np.nan
med = float(np.nanmedian(dem))
dem = np.where(np.isnan(dem), med, dem)
dem = np.clip(dem, -500, 9000)
grid = np.round(dem).astype("<i2")
grid.tofile(BIN)

meta = {
    "name": "SRTM N25E102 terrain heightmap (1 arc-second full)",
    "source": "SRTM 1 arc-second N25E102 (public domain, NASA/USGS)",
    "bbox": [102.0, 25.0, 103.0, 26.0],
    "west": 102.0, "south": 25.0, "east": 103.0, "north": 26.0,
    "width": n, "height": n, "resolutionDeg": 1.0 / 3600.0,
    "rowOrder": "north-to-south",
    "scale": 1.0, "offset": 0.0, "dtype": "int16-le",
    "minHeight": int(grid.min()), "maxHeight": int(grid.max()),
    "file": "N25E102-terrain.bin",
    "hillshade": "N25E102-hillshade.png",
    "license": "SRTM (public domain, NASA/USGS)",
}
json.dump(meta, open(JSON_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

# 阴影：高分辨率（4096），同时给近景提供细节
hf = grid.astype(np.float32)
step = 1.0 / (n - 1)
dy = step * 111132.0
dx = step * 111320.0 * math.cos(math.radians(25.5))
gy, gx = np.gradient(hf, dy, dx)
az = math.radians(315.0)
alt = math.radians(45.0)
slope = np.arctan(np.hypot(gx, gy))
aspect = np.arctan2(-gx, gy)
hs = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
t = np.clip((hf - float(grid.min())) / max(1.0, float(int(grid.max()) - int(grid.min()))), 0, 1)
r = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [80, 100, 130, 170, 235])
g = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [110, 130, 145, 165, 235])
b = np.interp(t, [0, 0.2, 0.45, 0.7, 1], [80, 90, 95, 110, 235])
shade = 0.42 + 0.72 * hs
rgb = np.stack([np.clip(r * shade, 0, 255), np.clip(g * shade, 0, 255), np.clip(b * shade, 0, 255)], axis=-1)
rgba = np.dstack([rgb.astype(np.uint8), np.full((n, n), 255, dtype=np.uint8)])
Image.fromarray(rgba, "RGBA").resize((4096, 4096), Image.LANCZOS).save(PNG)

print("written", BIN, os.path.getsize(BIN), PNG, os.path.getsize(PNG), "h", int(grid.min()), int(grid.max()))
