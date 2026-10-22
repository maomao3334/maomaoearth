#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把本地 ENVI 正射影像（BSQ/BIP/BIL, uint8）切成离线 XYZ 瓦片，供 MaomaoEarth 本地使用。

特点：
- 生成 WebMercator XYZ 瓦片（z/x/y，y 从北往南），JPEG（完整瓦片）+ PNG（含透明边界）。
- 只写入 data/local/ 下，不进入 Git / 发布包。
- 自动生成 data/local/imagery.json 清单，应用启动时读取。

用法：
  python tools/prepare_pek_ortho.py --src "C:\\Users\\A\\Downloads\\PEK"
  python tools/prepare_pek_ortho.py --src ... --minzoom 8 --maxzoom 15
  python tools/prepare_pek_ortho.py --src ... --maxzoom 12 --max-tiles 40   # 快速测试

ENVI 头文件默认找 <src>.HDR / <src>.hdr / <src>.hdr（Windows 不区分大小写）。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


# ----------------------------- ENVI 读取 -----------------------------
def parse_envi_header(path: str) -> dict:
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("latin-1")
    info = {}

    def field(name: str):
        m = re.search(re.escape(name) + r"\s*=\s*(.+?)(?:\r?\n|$)", text, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else None

    info["samples"] = int(field("samples"))
    info["lines"] = int(field("lines"))
    info["bands"] = int(field("bands"))
    info["header_offset"] = int(field("header offset") or 0)
    info["data_type"] = int(field("data type") or 1)
    info["interleave"] = (field("interleave") or "bsq").strip().lower()
    info["byte_order"] = int(field("byte order") or 0)
    if info["data_type"] != 1:
        raise SystemExit("只支持 ENVI data type = 1 (uint8)；当前为 %s" % info["data_type"])
    if info["interleave"] not in ("bsq", "bil", "bip"):
        raise SystemExit("不支持的 interleave：%s" % info["interleave"])
    if info["byte_order"] not in (0, 1):
        raise SystemExit("不支持的 byte order：%s" % info["byte_order"])

    m = re.search(r"map\s*info\s*=\s*\{([^}]*)\}", text, re.IGNORECASE | re.DOTALL)
    if not m:
        raise SystemExit("ENVI 头缺少 map info")
    parts = [p.strip() for p in m.group(1).split(",")]
    if len(parts) < 8 or not parts[0].lower().startswith("geographic"):
        raise SystemExit("只支持 Geographic Lat/Lon 投影；当前 map info = %s" % parts[:2])
    # Geographic Lat/Lon, refx, refy, lon, lat, dx, dy, datum, units
    info["lon0"] = float(parts[3])
    info["lat0"] = float(parts[4])
    info["dx"] = float(parts[5])
    info["dy"] = float(parts[6])
    return info


def memmap_band(path: str, info: dict, band_index: int):
    """band_index: 0-based。返回 (lines, samples) 的 uint8 memmap（仅 BSQ / BIP 重建）。"""
    if info["interleave"] != "bsq":
        raise SystemExit("当前脚本仅实现 BSQ 读取；BIL/BIP 请先用 ENVI/GDAL 转为 BSQ")
    samples = info["samples"]
    lines = info["lines"]
    offset = info["header_offset"] + band_index * samples * lines
    return np.memmap(path, dtype=np.uint8, mode="r", offset=offset, shape=(lines, samples))


# ----------------------------- 几何工具 -----------------------------
def deg2tile(lon, lat, z):
    n = 1 << z
    x = (lon + 180.0) / 360.0 * n
    lat = max(-85.05112877980659, min(85.05112877980659, lat))
    rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * n
    return x, y


def tile2deg(x, y, z):
    n = 1 << z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    return lon, lat


# ----------------------------- 影像处理 -----------------------------
def build_overview(src_bands, H, W, factor, block_rows=128):
    """从三个 uint8 波段（RGB 顺序）构建 factor 倍降采样数组。"""
    h = H // factor
    w = W // factor
    out = np.empty((h, w, 3), dtype=np.uint8)
    for ch, band in enumerate(src_bands):
        a = band
        for y0 in range(0, h, block_rows):
            y1 = min(h, y0 + block_rows)
            block = np.asarray(a[y0 * factor:y1 * factor, : w * factor], dtype=np.float32)
            block = block.reshape(y1 - y0, factor, w, factor).mean(axis=(1, 3))
            out[y0:y1, :, ch] = np.clip(block + 0.5, 0, 255).astype(np.uint8)
        print("  overview 1/%d band %d done" % (factor, ch + 1), flush=True)
    return out


def downsample_array(arr, factor):
    H, W = arr.shape[0], arr.shape[1]
    Hc = (H // factor) * factor
    Wc = (W // factor) * factor
    h, w = Hc // factor, Wc // factor
    out = np.empty((h, w, 3), dtype=np.uint8)
    for ch in range(3):
        block = arr[:Hc, :Wc, ch].reshape(h, factor, w, factor).astype(np.float32)
        out[:, :, ch] = np.clip(block.mean(axis=(1, 3)) + 0.5, 0, 255).astype(np.uint8)
    return out


def tone_curve(rgb: np.ndarray, black: float, white: float, gamma: float) -> np.ndarray:
    x = rgb.astype(np.float32)
    x = (x - black) / max(1.0, white - black)
    np.clip(x, 0.0, 1.0, out=x)
    if gamma != 1.0:
        x = np.power(x, gamma)
    return np.clip(x * 255.0 + 0.5, 0, 255).astype(np.uint8)


def resize_rgb(arr: np.ndarray, size=256) -> Image.Image:
    h, w = arr.shape[0], arr.shape[1]
    scale = size / float(max(h, w))
    if h < size or w < size:
        method = Image.Resampling.BILINEAR
    elif scale < 0.5:
        method = Image.Resampling.BOX
    elif scale < 0.9:
        method = Image.Resampling.LANCZOS
    else:
        method = Image.Resampling.BILINEAR
    return Image.fromarray(arr).resize((size, size), method)


def save_tile(rgb_arr, mask, out_path_base, quality, black, white, gamma):
    if mask is None or not mask.any():
        return 0
    if mask.all():
        img = resize_rgb(tone_curve(rgb_arr, black, white, gamma))
        path = out_path_base + ".jpg"
        img.save(path, "JPEG", quality=quality, optimize=False, subsampling=2)
        return 1
    # 含 no-data：透明 PNG
    rgb = tone_curve(rgb_arr, black, white, gamma)
    rgb_img = resize_rgb(rgb)
    alpha = Image.fromarray((mask.astype(np.uint8) * 255)).resize((256, 256), Image.Resampling.BOX)
    img = rgb_img.convert("RGBA")
    img.putalpha(alpha)
    path = out_path_base + ".png"
    img.save(path, "PNG", optimize=False, compress_level=3)
    return 2


# ----------------------------- 主流程 -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=r"C:\Users\A\Downloads\PEK", help="ENVI 影像文件（无扩展名或带扩展名均可）")
    ap.add_argument("--hdr", default=None, help="ENVI 头文件；默认自动查找")
    ap.add_argument("--out", default=None, help="瓦片输出根目录；默认 data/local/beijing-ortho")
    ap.add_argument("--minzoom", type=int, default=8)
    ap.add_argument("--maxzoom", type=int, default=15)
    ap.add_argument("--quality", type=int, default=84)
    ap.add_argument("--black", type=float, default=0.0)
    ap.add_argument("--white", type=float, default=202.0)
    ap.add_argument("--gamma", type=float, default=0.76)
    ap.add_argument("--max-tiles", type=int, default=0, help="只生成前 N 张瓦片（测试用）")
    ap.add_argument("--tile", default=None, help="只生成一张瓦片，格式 z/x/y（测试色彩/几何用）")
    ap.add_argument("--dry-run", action="store_true", help="只统计范围与瓦片数，不写文件")
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    if not os.path.isfile(src):
        raise SystemExit("找不到影像文件：%s" % src)
    hdr = args.hdr
    if not hdr:
        for cand in (src + ".HDR", src + ".hdr", os.path.splitext(src)[0] + ".HDR", os.path.splitext(src)[0] + ".hdr"):
            if os.path.isfile(cand):
                hdr = cand
                break
    if not hdr or not os.path.isfile(hdr):
        raise SystemExit("找不到 ENVI 头文件（可用 --hdr 指定）")

    info = parse_envi_header(hdr)
    samples, lines = info["samples"], info["lines"]
    print("源影像：%s" % src, flush=True)
    print("  尺寸 %d x %d x %d, uint8, %s, 像素 %.8f°" % (samples, lines, info["bands"], info["interleave"], info["dx"]), flush=True)
    print("  左上角像素中心：%.8f, %.8f" % (info["lon0"], info["lat0"]), flush=True)
    west0 = info["lon0"] - info["dx"] / 2.0
    north0 = info["lat0"] + info["dy"] / 2.0
    east0 = west0 + samples * info["dx"]
    south0 = north0 - lines * info["dy"]
    print("  覆盖范围：W %.5f E %.5f S %.5f N %.5f" % (west0, east0, south0, north0), flush=True)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_root = os.path.abspath(args.out or os.path.join(root, "data", "local", "beijing-ortho"))
    tiles_root = os.path.join(out_root, "tiles")
    print("输出：%s" % out_root, flush=True)

    # 三波段 → RGB（实测该镶嵌为 B,G,R,NIR；band3/2/1 -> R/G/B）
    b = [memmap_band(src, info, i) for i in range(min(4, info["bands"]))]
    if info["bands"] < 3:
        raise SystemExit("至少需要 3 个波段")
    rgb_bands = [b[2], b[1], b[0]]

    # 概览：1/8、1/16、1/32、1/64
    H8 = lines // 8
    W8 = samples // 8
    print("构建 1/8 概览 ...", flush=True)
    ov8 = build_overview(rgb_bands, H8 * 8, W8 * 8, 8)
    ov16 = downsample_array(ov8, 2)
    ov32 = downsample_array(ov16, 2)
    ov64 = downsample_array(ov32, 2)
    levels = {8: ov8, 16: ov16, 32: ov32, 64: ov64}
    print("概览完成：", {k: v.shape for k, v in levels.items()}, flush=True)

    # 用 1/64 概览估算有数据范围
    m = ov64.any(axis=2)
    rows = np.where(m.any(axis=1))[0]
    cols = np.where(m.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        raise SystemExit("概览中没有找到有效像素（全 0？）")
    r0, r1, c0, c1 = int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])
    pad = 2
    data_west = info["lon0"] + ((c0 - pad) * 64 - 0.5) * info["dx"]
    data_east = info["lon0"] + (((c1 + pad) + 1) * 64 - 0.5) * info["dx"]
    data_north = info["lat0"] - ((r0 - pad) * 64 - 0.5) * info["dy"]
    data_south = info["lat0"] - (((r1 + pad) + 1) * 64 - 0.5) * info["dy"]
    data_west = max(data_west, west0)
    data_east = min(data_east, east0)
    data_north = min(data_north, north0)
    data_south = max(data_south, south0)
    print("有数据范围：W %.5f E %.5f S %.5f N %.5f" % (data_west, data_east, data_south, data_north), flush=True)

    if args.tile:
        try:
            z, tx, ty = [int(v) for v in str(args.tile).split("/")]
        except Exception:
            raise SystemExit("--tile 格式应为 z/x/y，例如 12/3372/1547")
        factor = 64 if z <= 8 else 32 if z == 9 else 16 if z == 10 else 8 if z == 11 else 1
        level = levels.get(factor) if factor > 1 else None
        lh, lw = (level.shape[0], level.shape[1]) if level is not None else (lines, samples)
        lon_w, lat_n = tile2deg(tx, ty, z)
        lon_e, lat_s = tile2deg(tx + 1, ty + 1, z)
        row_top = (info["lat0"] - lat_n) / info["dy"] / factor
        row_bot = (info["lat0"] - lat_s) / info["dy"] / factor
        rr0 = max(0, int(math.floor(min(row_top, row_bot))) - 1)
        rr1 = min(lh, int(math.ceil(max(row_top, row_bot))) + 1)
        if factor > 1:
            strip = level[rr0:rr1, :, :]
        else:
            strip = np.stack([rgb_bands[0][rr0:rr1, :], rgb_bands[1][rr0:rr1, :], rgb_bands[2][rr0:rr1, :]], axis=2)
        col_l = (lon_w - info["lon0"]) / info["dx"] / factor
        col_r = (lon_e - info["lon0"]) / info["dx"] / factor
        cc0 = max(0, int(math.floor(col_l)) - 1)
        cc1 = min(lw, int(math.ceil(col_r)) + 1)
        sub = strip[:, cc0:cc1, :]
        mask = sub.any(axis=2)
        if not mask.any():
            raise SystemExit("该瓦片没有有效像素：%s" % args.tile)
        zb = os.path.join(tiles_root, str(z), str(tx))
        os.makedirs(zb, exist_ok=True)
        save_tile(sub, mask, os.path.join(zb, str(ty)), args.quality, args.black, args.white, args.gamma)
        write_manifest(out_root, data_west, data_east, data_south, data_north, args, z)
        print("单瓦片完成：%s" % args.tile, flush=True)
        return

    # 统计每级瓦片范围
    plan = []
    for z in range(args.minzoom, args.maxzoom + 1):
        x0 = int(math.floor(deg2tile(data_west, data_south, z)[0]))
        x1 = int(math.floor(deg2tile(data_east, data_north, z)[0]))
        y0 = int(math.floor(deg2tile(data_west, data_north, z)[1]))
        y1 = int(math.floor(deg2tile(data_east, data_south, z)[1]))
        plan.append((z, x0, x1, y0, y1))
        print("  z%-2d  x %d..%d (%d)  y %d..%d (%d)  bbox %d 张" % (
            z, x0, x1, x1 - x0 + 1, y0, y1, y1 - y0 + 1,
            (x1 - x0 + 1) * (y1 - y0 + 1)), flush=True)
    if args.dry_run:
        print("dry-run：不写文件。", flush=True)
        return

    os.makedirs(tiles_root, exist_ok=True)
    total_written = 0
    t_start = time.time()
    for z, x0, x1, y0, y1 in plan:
        factor = 64 if z <= 8 else 32 if z == 9 else 16 if z == 10 else 8 if z == 11 else 1
        level = levels.get(factor) if factor > 1 else None
        lh, lw = (level.shape[0], level.shape[1]) if level is not None else (lines, samples)
        z_written = 0
        z_start = time.time()
        for ty in range(y0, y1 + 1):
            _, lat_n = tile2deg(x0, ty, z)
            lat_s = tile2deg(x0, ty + 1, z)[1]
            row_top = (info["lat0"] - lat_n) / info["dy"] / factor
            row_bot = (info["lat0"] - lat_s) / info["dy"] / factor
            rr0 = max(0, int(math.floor(min(row_top, row_bot))) - 1)
            rr1 = min(lh, int(math.ceil(max(row_top, row_bot))) + 1)
            if rr1 <= rr0:
                continue
            if factor > 1:
                strip = level[rr0:rr1, :, :]
            else:
                strip = np.stack([rgb_bands[0][rr0:rr1, :], rgb_bands[1][rr0:rr1, :], rgb_bands[2][rr0:rr1, :]], axis=2)
            for tx in range(x0, x1 + 1):
                lon_w = tile2deg(tx, ty, z)[0]
                lon_e = tile2deg(tx + 1, ty, z)[0]
                col_l = (lon_w - info["lon0"]) / info["dx"] / factor
                col_r = (lon_e - info["lon0"]) / info["dx"] / factor
                cc0 = max(0, int(math.floor(col_l)) - 1)
                cc1 = min(lw, int(math.ceil(col_r)) + 1)
                if cc1 <= cc0:
                    continue
                sub = strip[:, cc0:cc1, :]
                mask = sub.any(axis=2)
                if not mask.any():
                    continue
                zb = os.path.join(tiles_root, str(z), str(tx))
                os.makedirs(zb, exist_ok=True)
                written = save_tile(sub, mask, os.path.join(zb, str(ty)), args.quality, args.black, args.white, args.gamma)
                if written:
                    total_written += 1
                    z_written += 1
                if args.max_tiles and total_written >= args.max_tiles:
                    print("达到 --max-tiles=%d，停止。" % args.max_tiles, flush=True)
                    write_manifest(out_root, data_west, data_east, data_south, data_north, args, z)
                    print("本次写入 %d 张，用时 %.1fs" % (total_written, time.time() - t_start), flush=True)
                    return
            del strip
            if (ty - y0) % 20 == 0:
                print("  z%d row %d/%d  tiles=%d  elapsed=%.0fs" % (z, ty - y0 + 1, y1 - y0 + 1, z_written, time.time() - z_start), flush=True)
        print("z%d 完成：%d 张，用时 %.1fs" % (z, z_written, time.time() - z_start), flush=True)

    write_manifest(out_root, data_west, data_east, data_south, data_north, args, args.maxzoom)
    print("全部完成：%d 张瓦片，用时 %.1fs，输出 %s" % (total_written, time.time() - t_start, out_root), flush=True)


def write_manifest(out_root, west, east, south, north, args, maxzoom):
    manifest = {
        "version": 1,
        "autoLoad": True,
        "datasets": [
            {
                "id": "beijing-ortho",
                "name": "北京正射影像",
                "note": "本地 ENVI 正射镶嵌 · 约 5 m · 仅本机使用，不上传",
                "type": "xyz",
                "scheme": "webmercator",
                "url": "data/local/beijing-ortho/tiles/{z}/{x}/{y}.{ext}",
                "minzoom": args.minzoom,
                "maxzoom": maxzoom,
                "bounds": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
                "attribution": "本地正射影像（仅本机）",
                "opacity": 1.0,
                "autoLoad": True,
            }
        ],
    }
    local_dir = os.path.dirname(out_root)
    manifest_path = os.path.join(local_dir, "imagery.json")
    os.makedirs(local_dir, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("清单已写入：%s" % manifest_path, flush=True)


if __name__ == "__main__":
    main()
