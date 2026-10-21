p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read().replace('const string Version = "0.5.1";','const string Version = "0.5.2";',1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read().replace("version: '0.5.1'","version: '0.5.2'",1)
open(p2,'w',encoding='utf-8',newline='').write(a)
p3=r'G:\sh\local-earth\README.md'
r=open(p3,encoding='utf-8').read()
r=r.replace('> **v0.5.1**','> **v0.5.2**',1).replace('maomaoearth-v0.5.1.zip','maomaoearth-v0.5.2.zip',1)
old='- **超大 KML/KMZ 性能**'
new='- **底图显示修复**：低画质/无地形时国界 GeoJSON 面曾默认白色填充，盖住卫星底图；已显式改为只描边，并让缺失 S2 瓦片透明（详见 docs/MAP-DISPLAY-FIX.md）。\n- **超大 KML/KMZ 性能**'
assert old in r
r=r.replace(old,new,1)
old2='- [KML/KMZ 性能优化](docs/KML-PERF.md)：分片/快速解析、静态线 Primitive、前后对比数据'
new2=old2+'\n- [底图白块修复](docs/MAP-DISPLAY-FIX.md)：国界面填充、S2 缺失瓦片透明、低画质验证'
assert old2 in r
r=r.replace(old2,new2,1)
open(p3,'w',encoding='utf-8',newline='').write(r)
print('v0.5.2 patched')
