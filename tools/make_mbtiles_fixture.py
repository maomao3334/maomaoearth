import os, sqlite3, math, shutil
root=r'G:\sh\local-earth'
src=os.path.join(root,'data','public','imagery','s2cloudless')
outdir=os.path.join(root,'data','samples','mbtiles'); os.makedirs(outdir, exist_ok=True)
out=os.path.join(outdir,'wind-area.mbtiles')
if os.path.exists(out): os.remove(out)
def tilexy(lon,lat,z):
    n=2**z; x=int((lon+180.0)/360.0*n); la=math.radians(lat); y=int((1.0-math.log(math.tan(la)+1.0/math.cos(la))/math.pi)/2.0*n); return x,y
def tile_bounds(x,y,z):
    n=float(2**z)
    lon1=x/n*360.0-180.0; lon2=(x+1)/n*360.0-180.0
    lat1=math.degrees(math.atan(math.sinh(math.pi*(1-2*y/n))))
    lat2=math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+1)/n))))
    return lon1,lat2,lon2,lat1  # west,south,east,north
z0=10; cx,cy=tilexy(102.4,25.05,z0)
tiles=[]
for z in (10,11,12):
    scale=2**(z-z0); cxz=cx*scale; cyz=cy*scale
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            x=cxz+dx; y=cyz+dy
            p=os.path.join(src,str(z),str(x),str(y)+'.jpg')
            if os.path.exists(p): tiles.append((z,x,y,p))
print('tiles',len(tiles))
bounds=tile_bounds(cx-1,cy-1,z0)
w,s,e,n=bounds
con=sqlite3.connect(out)
con.execute('CREATE TABLE metadata (name TEXT, value TEXT)')
con.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
con.execute('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)')
meta={
 'name':'Wind Area MBTiles Sample',
 'format':'jpg',
 'bounds':'%f,%f,%f,%f'%(w,s,e,n),
 'minzoom':'10','maxzoom':'12',
 'scheme':'tms',
 'type':'baselayer',
 'version':'1.0',
 'description':'Offline MBTiles fixture generated from local Sentinel-2 cloudless tiles',
 'attribution':'Sentinel-2 cloudless by EOX IT Services GmbH (CC BY 4.0)',
}
con.executemany('INSERT INTO metadata(name,value) VALUES (?,?)', meta.items())
for z,x,y,p in tiles:
    with open(p,'rb') as f: data=f.read()
    row=(1<<z)-1-y
    con.execute('INSERT INTO tiles(zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)',(z,x,row,data))
con.commit(); con.close()
print('wrote',out,os.path.getsize(out))
