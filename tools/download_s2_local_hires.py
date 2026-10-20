"""下载风场区域的高清 Sentinel-2 cloudless 瓦片（z9–z14），用于近景卫星影像。"""
import math
import os
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = r"G:\sh\local-earth\data\public\imagery\s2cloudless"
BASE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
WEST, SOUTH, EAST, NORTH = 102.2, 24.95, 102.6, 25.15


def merc_y(lat):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0


def tile_range(z):
    n = 2 ** z
    x0 = math.floor((WEST + 180.0) / 360.0 * n)
    x1 = math.floor((EAST + 180.0) / 360.0 * n)
    y0 = math.floor(merc_y(NORTH) * n)
    y1 = math.floor(merc_y(SOUTH) * n)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def fetch(z, x, y):
    path = os.path.join(ROOT, str(z), str(x), f"{y}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 1500:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = BASE.format(z=z, x=x, y=y)
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "local-earth/1.0"})
            data = urllib.request.urlopen(req, timeout=60).read()
            if len(data) > 1500 and data[:2] == b"\xff\xd8":
                open(path, "wb").write(data)
                return path
        except Exception:  # noqa: BLE001
            pass
    try:
        subprocess.run(["curl.exe", "-L", "-4", "--retry", "5", "--retry-delay", "2",
                        "--connect-timeout", "20", "-s", "-o", path, url], timeout=180, check=False)
        if os.path.exists(path) and os.path.getsize(path) > 1500:
            return path
    except Exception:  # noqa: BLE001
        pass
    return None


def main():
    plan = []
    for z in range(9, 15):
        tiles = tile_range(z)
        print(f"z{z}: {len(tiles)}", flush=True)
        plan.extend((z, x, y) for x, y in tiles)
    print("total", len(plan), flush=True)
    done = 0
    failed = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(fetch, z, x, y): (z, x, y) for z, x, y in plan}
        for fut in as_completed(futures):
            if not fut.result():
                failed.append(futures[fut])
            done += 1
            if done % 100 == 0 or done == len(plan):
                print(f"done {done}/{len(plan)} failed {len(failed)}", flush=True)
    if failed:
        print("retry", len(failed), flush=True)
        for z, x, y in failed:
            fetch(z, x, y)
    total = 0
    count = 0
    for z in range(9, 15):
        d = os.path.join(ROOT, str(z))
        if os.path.isdir(d):
            for root, _, files in os.walk(d):
                for fn in files:
                    total += os.path.getsize(os.path.join(root, fn))
                    count += 1
    print(f"local hi-res tiles {count}, {total} bytes", flush=True)


if __name__ == "__main__":
    main()
