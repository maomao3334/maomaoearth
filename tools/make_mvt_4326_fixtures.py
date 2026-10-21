import os, sqlite3, math, io
from PIL import Image, ImageDraw
root=r'G:\sh\local-earth'
outdir=os.path.join(root,'data','samples','mbtiles'); os.makedirs(outdir, exist_ok=True)

def varint(n):
    out=bytearray()
    while True:
        b=n & 0x7f; n >>= 7
        if n: out.append(b|0x80)
        else: out.append(b); break
    return bytes(out)
def tag(field,wire): return varint((field<<3)|wire)
def ld(field,data): return tag(field,2)+varint(len(data))+data
def v(field,n): return tag(field,0)+varint(n)
def zz(n): return (n<<1) ^ (n>>63) if n<0 else (n<<1)

def layer(name, feats, extent=4096, version=2):
    keys=[]; vals=[]
    def keyidx(k):
        if k not in keys: keys.append(k)
        return keys.index(k)
    def validx(val):
        enc=ld(1,val.encode('utf-8'))
        if enc not in vals: vals.append(enc)
        return vals.index(enc)
    fbytes=b''
    for i,(typ,tags,geom) in enumerate(feats):
        fb=v(1,i+1)
        tv=[]
        for k,val in tags.items():
            tv += [keyidx(k), validx(val)]
        if tv: fb += ld(2, b''.join(varint(x) for x in tv))
        fb += v(3,typ)
        fb += ld(4, b''.join(varint(x) for x in geom))
        fbytes += ld(2,fb)
    b=ld(1,name.encode('utf-8'))+fbytes
    for k in keys: b += ld(3,k.encode('utf-8'))
    for val in vals: b += ld(4,val)
    b += v(5,extent)+v(15,version)
    return b

def geom_poly():
    # square ring, absolute 0,0 -> 4096,0 -> 4096,4096 -> 0,4096 -> close
    return [9,0,0, 26,4096,0, 0,4096, 8192,0, 15]
def geom_line():
    return [9,0,2048, 26,4096,0]
def geom_point():
    return [9,2048,2048]

def make_vector(path, crs, bounds, tiles):
    if os.path.exists(path): os.remove(path)
    water=layer('water',[(3,{'class':'water','name':'测试湖'},geom_poly())])
    road=layer('road',[(2,{'class':'road','name':'测试路'},geom_line())])
    place=layer('place',[(1,{'class':'place','name':'测试点'},geom_point())])
    data=ld(3,water)+ld(3,road)+ld(3,place)
    con=sqlite3.connect(path)
    con.execute('CREATE TABLE metadata(name TEXT,value TEXT)')
    con.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
    con.execute('CREATE UNIQUE INDEX ti ON tiles(zoom_level,tile_column,tile_row)')
    meta={'name':'MVT %s Test'%crs,'format':'pbf','scheme':'tms','crs':crs,'bounds':bounds,'minzoom':'0','maxzoom':'0','attribution':'MVT test'}
    for k,val in meta.items(): con.execute('INSERT INTO metadata VALUES (?,?)',(k,val))
    for (z,x,y) in tiles:
        row=(1<<z)-1-y
        con.execute('INSERT INTO tiles VALUES (?,?,?,?)',(z,x,row,data))
    con.commit(); con.close(); print('wrote',path,os.path.getsize(path))

def png_tile(color, label):
    im=Image.new('RGB',(256,256),color); d=ImageDraw.Draw(im)
    d.rectangle([12,12,244,244],outline=(255,255,255),width=4)
    d.text((24,24),label,fill=(255,255,255))
    b=io.BytesIO(); im.save(b,format='PNG'); return b.getvalue()

def make_raster4326(path):
    if os.path.exists(path): os.remove(path)
    con=sqlite3.connect(path)
    con.execute('CREATE TABLE metadata(name TEXT,value TEXT)')
    con.execute('CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB)')
    con.execute('CREATE UNIQUE INDEX ti ON tiles(zoom_level,tile_column,tile_row)')
    meta={'name':'EPSG:4326 Raster Test','format':'png','scheme':'tms','crs':'EPSG:4326','bounds':'-180,-90,180,90','minzoom':'0','maxzoom':'0','attribution':'4326 test'}
    for k,val in meta.items(): con.execute('INSERT INTO metadata VALUES (?,?)',(k,val))
    con.execute('INSERT INTO tiles VALUES (?,?,?,?)',(0,0,0,png_tile((35,85,140),'4326 left')))
    con.execute('INSERT INTO tiles VALUES (?,?,?,?)',(0,1,0,png_tile((80,130,70),'4326 right')))
    con.commit(); con.close(); print('wrote',path,os.path.getsize(path))

make_vector(os.path.join(outdir,'vector-3857.mbtiles'),'EPSG:3857','-180,-85,180,85',[(0,0,0)])
make_vector(os.path.join(outdir,'vector-4326.mbtiles'),'EPSG:4326','-180,-90,180,90',[(0,0,0),(0,1,0)])
make_raster4326(os.path.join(outdir,'raster-4326.mbtiles'))
