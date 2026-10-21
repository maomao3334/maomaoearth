p=r'G:\sh\local-earth\README.md'
c=open(p,encoding='utf-8').read()
c=c.replace('> **v0.5.0**','> **v0.5.1**',1)
c=c.replace('maomaoearth-v0.5.0.zip','maomaoearth-v0.5.1.zip',1)
old='- **MBTiles 直读**'
new='- **超大 KML/KMZ 性能**：10 万级 Placemark 动画文件（如风场 timeline）按 Placemark 分片/快速解析、线动画用静态 `Primitive` 帧播放器；109 MB KML 实测从 12 s/2.4 FPS 降到 4 s/60 FPS（详见 docs/KML-PERF.md）。\n- **MBTiles 直读**'
assert old in c
c=c.replace(old,new,1)
old2='- [MBTiles 说明与验证](docs/MBTILES.md)：本地 SQLite 瓦片服务、TMS、4326、MVT 测试记录'
new2=old2+'\n- [KML/KMZ 性能优化](docs/KML-PERF.md)：分片/快速解析、静态线 Primitive、前后对比数据'
assert old2 in c
c=c.replace(old2,new2,1)
# limitation note after MBTiles/local-only lines: append a performance limitation
old3='- **工程**：不内嵌本地 KML/KMZ/GeoTIFF；Wind3D 仅保存当前场景。'
new3='- **超大 KML 快速路径**：只对“扁平、无 Polygon/MultiGeometry/GroundOverlay、Style 在文档头”的简单 KML 启用；其它结构自动回退完整 DOM 分片解析。快速路径不解析 ExtendedData/description 弹窗字段。\n'+old3
if old3 in c: c=c.replace(old3,new3,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('README v0.5.1 patched')
