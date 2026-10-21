"""
生成最小 MVT(Mapbox Vector Tile) 样例并打包成 MBTiles。

产物:
  data/samples/mbtiles/vector-sample.mbtiles
    - metadata: format=pbf, scheme=tms, crs=EPSG:3857, bounds 覆盖 z0 瓦片, minzoom=maxzoom=0
    - tiles: 单个 WebMercator z0 瓦片 (tile_column=0, tile_row=0)
    - 图层 "sample"（extent=4096, version=2）:
        * polygon：带洞的面（tags: class/name/rank/visible/area_km2，覆盖 string/int/bool/double 值类型）
        * line   ：折线（tags: class/name/rank）
        * point  ：点（tags: class/name/rank）

用途：供 js/mvt.js 的前端解码/栅格化与 Cesium ImageryProvider 集成测试，完全离线。
运行：python tools/make_mvt_fixture.py
"""
import os
import sqlite3
import hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'samples', 'mbtiles')
OUT_PATH = os.path.join(OUT_DIR, 'vector-sample.mbtiles')

# z0 WebMercator 覆盖范围
BOUNDS = '-180,-85.05112877980659,180,85.05112877980659'

EXTENT = 4096
LAYER_NAME = 'sample'


# ---------------------------------------------------------------------------
# protobuf 基础编码（MVT 规范）
# ---------------------------------------------------------------------------
def varint(n):
    """无符号 varint 编码。"""
    if n < 0:
        raise ValueError('varint 只接受非负整数')
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def zigzag(n):
    """sint32/sint64 zigzag 编码。"""
    return (n << 1) ^ (n >> 63) if n < 0 else (n << 1)


def key(field, wire):
    return varint((field << 3) | wire)


def ld(field, data):
    """length-delimited 字段。"""
    return key(field, 2) + varint(len(data)) + data


def vint(field, n):
    """varint 字段。"""
    return key(field, 0) + varint(n)


def packed(field, values):
    return ld(field, b''.join(varint(v) for v in values))


# ---------------------------------------------------------------------------
# 值 / 要素 / 图层编码
# ---------------------------------------------------------------------------
def encode_value(value):
    """按 Python 类型选择 MVT Value 的字段类型。"""
    if isinstance(value, bool):
        return vint(7, 1 if value else 0)
    if isinstance(value, int):
        return vint(4, value)  # int64
    if isinstance(value, float):
        import struct
        return key(3, 1) + struct.pack('<d', value)  # double
    if isinstance(value, str):
        return ld(1, value.encode('utf-8'))
    raise TypeError('不支持的属性值类型: %r' % (value,))


def encode_feature(fid, ftype, tags, geometry):
    """Feature{ id=1, tags=2, type=3, geometry=4 }。"""
    fb = vint(1, fid)
    if tags:
        fb += packed(2, tags)
    fb += vint(3, ftype)
    fb += packed(4, geometry)
    return ld(2, fb)


def encode_layer(name, features, extent=EXTENT, version=2):
    """Layer{ name=1, features=2, keys=3, values=4, extent=5, version=15 }。"""
    keys = []
    values = []  # 已编码的 Value 字节，去重后写回索引

    def key_index(k):
        if k not in keys:
            keys.append(k)
        return keys.index(k)

    def value_index(val):
        enc = encode_value(val)
        if enc not in values:
            values.append(enc)
        return values.index(enc)

    feature_blobs = []
    for fid, ftype, props, geometry in features:
        tag_ints = []
        for k, val in props.items():
            tag_ints.append(key_index(k))
            tag_ints.append(value_index(val))
        feature_blobs.append(encode_feature(fid, ftype, tag_ints, geometry))

    layer = ld(1, name.encode('utf-8')) + b''.join(feature_blobs)
    for k in keys:
        layer += ld(3, k.encode('utf-8'))
    for val in values:
        layer += ld(4, val)
    layer += vint(5, extent)
    layer += vint(15, version)
    return layer


# ---------------------------------------------------------------------------
# 几何编码：MoveTo(1)/LineTo(2)/ClosePath(7)，坐标为相对上一点的 zigzag delta
# ---------------------------------------------------------------------------
def geometry_from_rings(rings):
    """rings: [[(x,y), ...], ...] -> 命令流（MoveTo + LineTo + ClosePath）。"""
    cmds = []
    cx, cy = 0, 0
    for ring in rings:
        pts = list(ring)
        if len(pts) < 3:
            continue
        # MoveTo count=1
        x, y = pts[0]
        cmds += [(1 << 3) | 1, zigzag(x - cx), zigzag(y - cy)]
        cx, cy = x, y
        # LineTo count=len(pts)-1
        rest = pts[1:]
        cmds += [((len(rest)) << 3) | 2]
        for x, y in rest:
            cmds += [zigzag(x - cx), zigzag(y - cy)]
            cx, cy = x, y
        # ClosePath count=1
        cmds += [(1 << 3) | 7]
    return cmds


def geometry_line(points):
    """折线：MoveTo 1 点 + LineTo N-1 点。"""
    points = list(points)
    cmds = []
    x0, y0 = points[0]
    cmds += [(1 << 3) | 1, zigzag(x0), zigzag(y0)]
    rest = points[1:]
    cmds += [((len(rest)) << 3) | 2]
    cx, cy = x0, y0
    for x, y in rest:
        cmds += [zigzag(x - cx), zigzag(y - cy)]
        cx, cy = x, y
    return cmds


def geometry_points(points):
    """MultiPoint：MoveTo count=N + N 组 zigzag 坐标。"""
    points = list(points)
    cmds = [((len(points)) << 3) | 1]
    cx, cy = 0, 0
    for x, y in points:
        cmds += [zigzag(x - cx), zigzag(y - cy)]
        cx, cy = x, y
    return cmds


def build_tile():
    # 面：外环（顺时针）+ 洞（逆时针），evenodd 填充
    outer = [(1024, 1024), (3072, 1024), (3072, 3072), (1024, 3072)]
    hole = [(1792, 1792), (1792, 2304), (2304, 2304), (2304, 1792)]
    polygon_geom = geometry_from_rings([outer, hole])

    # 线：穿过瓦片的折线
    line_geom = geometry_line([(384, 3584), (1280, 2816), (2176, 3584), (3072, 2816), (3712, 3584)])

    # 点：一个地标点
    point_geom = geometry_points([(2048, 3584)])

    features = [
        (1, 3, {
            'class': 'landuse',
            'name': 'Sample Area',
            'rank': 1,
            'visible': True,
            'area_km2': 1234.5,
        }, polygon_geom),
        (2, 2, {
            'class': 'road',
            'name': 'Sample Road',
            'rank': 2,
        }, line_geom),
        (3, 1, {
            'class': 'place',
            'name': 'Sample Point',
            'rank': 3,
        }, point_geom),
    ]
    layer = encode_layer(LAYER_NAME, features)
    tile = ld(3, layer)  # Tile.layers = 3
    return tile, features


# ---------------------------------------------------------------------------
# MBTiles(SQLite) 打包
# ---------------------------------------------------------------------------
def write_mbtiles(path, tile_data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)

    con = sqlite3.connect(path)
    try:
        con.execute('CREATE TABLE metadata (name TEXT, value TEXT)')
        con.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
        con.execute('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)')

        metadata = [
            ('name', 'Local Earth MVT Sample'),
            ('format', 'pbf'),
            ('scheme', 'tms'),
            ('crs', 'EPSG:3857'),
            ('bounds', BOUNDS),
            ('minzoom', '0'),
            ('maxzoom', '0'),
            ('attribution', 'Local Earth synthetic MVT sample'),
            ('description', 'Single z0 WebMercator MVT tile: polygon(with hole) + line + point, tags included.'),
            ('version', '1'),
            ('type', 'overlay'),
        ]
        con.executemany('INSERT INTO metadata (name, value) VALUES (?, ?)', metadata)

        z, x, y = 0, 0, 0
        row = (1 << z) - 1 - y  # TMS 行号
        con.execute(
            'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
            (z, x, row, sqlite3.Binary(tile_data)),
        )
        con.commit()

        # 回读自检
        got = con.execute(
            'SELECT tile_data FROM tiles WHERE zoom_level=0 AND tile_column=0 AND tile_row=0'
        ).fetchone()
        assert got is not None and bytes(got[0]) == tile_data, 'MBTiles 回读校验失败'
        meta_count = con.execute('SELECT COUNT(*) FROM metadata').fetchone()[0]
    finally:
        con.close()
    return meta_count


def main():
    tile_data, features = build_tile()
    meta_count = write_mbtiles(OUT_PATH, tile_data)
    size = os.path.getsize(OUT_PATH)
    digest = hashlib.sha256(tile_data).hexdigest()
    print('MVT layer      :', LAYER_NAME, 'extent', EXTENT, 'version 2')
    print('MVT features   :', len(features), '(polygon=1, line=1, point=1)')
    print('MVT tile bytes :', len(tile_data), 'sha256', digest)
    print('MBTiles        :', OUT_PATH)
    print('MBTiles bytes  :', size, 'metadata rows:', meta_count)
    print('bounds         :', BOUNDS)


if __name__ == '__main__':
    main()
