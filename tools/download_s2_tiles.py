"""下载 Sentinel-2 cloudless 瓦片（EOX WMTS）用于东亚/中国卫星影像叠加。

- z5–z7：东亚 bbox 55–150E / 0–60N
- z8：中国 bbox 72–136E / 17–55N
输出：data/public/imagery/s2cloudless/{z}/{x}/{y}.jpg
授权：Sentinel-2 cloudless by EOX IT Services GmbH，CC BY 4.0。
"""
import math
import os
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = r"G:\sh\local-earth\data\public\imagery\s2cloudless"
BASE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"


def merc_y(lat):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0


def tile_range(z, west, south, east, north):
    n = 2 ** z
    x0 = max(0, math.floor((west + 180.0) / 360.0 * n))
    x1 = min(n - 1, math.floor((east + 180.0) / 360.0 * n))
    y0 = max(0, math.floor(merc_y(north) * n))
    y1 = min(n - 1, math.floor(merc_y(south) * n))
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def fetch(z, x, y):
    path = os.path.join(ROOT, str(z), str(x), f"{y}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = BASE.format(z=z, x=x, y=y)
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "local-earth/1.0"})
            data = urllib.request.urlopen(req, timeout=60).read()
            if len(data) > 2000 and data[:2] == b"\xff\xd8":
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
        if os.path.exists(path) and os.path.getsize(path) > 2000:
            return path
    except Exception:  # noqa: BLE001
        pass
    return None


def main():
    east_asia = (55.0, 0.0, 150.0, 60.0)
    china = (72.0, 17.0, 136.0, 55.0)
    plan = [(5, east_asia), (6, east_asia), (7, east_asia), (8, china)]
    tasks = []
    for z, (w, s, e, n) in plan:
        tiles = tile_range(z, w, s, e, n)
        print(f"z{z}: {len(tiles)} tiles", flush=True)
        tasks.extend((z, x, y) for x, y in tiles)
    print(f"total tiles {len(tasks)}", flush=True)
    done = 0
    failed = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch, z, x, y): (z, x, y) for z, x, y in tasks}
        for fut in as_completed(futures):
            if not fut.result():
                failed.append(futures[fut])
            done += 1
            if done % 200 == 0 or done == len(tasks):
                print(f"downloaded {done}/{len(tasks)} (failed {len(failed)})", flush=True)
    if failed:
        print(f"retrying {len(failed)}", flush=True)
        for z, x, y in failed:
            fetch(z, x, y)
        still = [t for t in failed if not (os.path.exists(os.path.join(ROOT, str(t[0]), str(t[1]), f"{t[2]}.jpg")))]
        if still:
            print(f"WARNING missing {len(still)}: {still[:10]}", flush=True)
    total = 0
    count = 0
    for dirpath, _, files in os.walk(ROOT):
        for fn in files:
            total += os.path.getsize(os.path.join(dirpath, fn))
            count += 1
    print(f"done: {count} files, {total} bytes ({total/1024/1024:.1f} MB)", flush=True)


if __name__ == "__main__":
    main()
