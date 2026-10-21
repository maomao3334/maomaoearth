p=r'G:\sh\local-earth\docs\API.md'
c=open(p,encoding='utf-8').read()
c=c.replace('## MBTiles（v0.4.0）','## MBTiles（v0.5.0）')
old='''底层对象：`LEMBTiles`（`load/clear/getState/openDialog`）。
详见 [MBTILES.md](MBTILES.md)。'''
new='''底层对象：`LEMBTiles`（`load/clear/getState/openDialog`）；矢量 pbf 走 `LEMvt.createImageryProvider`。
支持 png/jpg/webp 栅格、pbf/MVT 矢量、EPSG:3857/4326；详见 [MBTILES.md](MBTILES.md)、[MVT.md](MVT.md)。'''
if old in c: c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\docs\PACKAGING.md'
d=open(p2,encoding='utf-8').read().replace('约 25 KB','约 30 KB')
open(p2,'w',encoding='utf-8',newline='').write(d)
print('docs updated')
