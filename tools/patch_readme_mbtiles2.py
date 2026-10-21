p=r'G:\sh\local-earth\README.md'
c=open(p,encoding='utf-8').read()
anchor='> 仓库源码出于体积原因**不包含**大型栅格/影像瓦片（见“数据包说明”）。没有数据包时程序仍可启动，但地形/卫星影像/底图瓦片会缺失。'
add=anchor+'\n>\n> MBTiles 使用：`MaoMaoEarth.exe mbtiles "D:\\\\data\\\\china.mbtiles"`，详见 [docs/MBTILES.md](docs/MBTILES.md)。'
if anchor in c and 'MBTiles 使用：`MaoMaoEarth.exe' not in c:
    c=c.replace(anchor,add,1); open(p,'w',encoding='utf-8',newline='').write(c); print('README note added')
else: print('note already/missing')
# docs screenshot path to committed screenshot
p2=r'G:\sh\local-earth\docs\MBTILES.md'
d=open(p2,encoding='utf-8').read().replace('docs/testdata/mbtiles-app.png','docs/screenshots/08-mbtiles.png')
open(p2,'w',encoding='utf-8',newline='').write(d)
print('MBTILES doc screenshot path updated')
