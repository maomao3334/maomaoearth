p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read().replace('const string Version = "0.5.2";','const string Version = "0.6.0";',1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read().replace("version: '0.5.2'","version: '0.6.0'",1)
open(p2,'w',encoding='utf-8',newline='').write(a)
p3=r'G:\sh\local-earth\README.md'
r=open(p3,encoding='utf-8').read()
r=r.replace('> **v0.5.2**','> **v0.6.0**',1).replace('maomaoearth-v0.5.2.zip','maomaoearth-v0.6.0.zip',1)
old='- **底图显示修复**'
new='- **坐标标点**：经纬度支持十进制度/度分秒切换、单行粘贴、地图选点；可自定义名称/备注/颜色，名称标签常显；支持标记点列表管理、拖拽、CSV/GeoJSON/KML 导出、CSV/GeoJSON 导入、工程保存（详见 docs/MARKERS.md）。\n- **底图显示修复**'
assert old in r
r=r.replace(old,new,1)
old2='- [底图白块修复](docs/MAP-DISPLAY-FIX.md)：国界面填充、S2 缺失瓦片透明、低画质验证'
new2=old2+'\n- [坐标标点](docs/MARKERS.md)：十进制度/度分秒、地图选点、列表/拖拽、导入导出'
assert old2 in r
r=r.replace(old2,new2,1)
# screenshot table add row after MBTiles table row
old3='| 本地 SQLite 瓦片服务 + ImageryProvider | 纯 JS MVT 解码 + Canvas 栅格化 |'
new3=old3+'\n\n| 坐标标点 | |\n|---|---|\n| ![坐标标点](docs/screenshots/13-markers.png) | 十进制度/度分秒 + 名称标签 + 列表管理 |'
if old3 in r: r=r.replace(old3,new3,1)
# directory add markers.js near mbtiles
r=r.replace('    mbtiles.js               # MBTiles 本地瓦片服务客户端（v0.5.0）','    mbtiles.js               # MBTiles 本地瓦片服务客户端（v0.5.0）\n    markers.js               # 坐标标点：DMS/列表/导入导出（v0.6.0）',1)
open(p3,'w',encoding='utf-8',newline='').write(r)
print('v0.6.0 patched')
