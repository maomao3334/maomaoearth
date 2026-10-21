p=r'G:\sh\local-earth\index.html'
c=open(p,encoding='utf-8').read()
old='''        <button id="btn-xyz-dir" class="wide" title="选择本地 XYZ 瓦片目录（…/z/x/y.png|jpg）">本地 XYZ 瓦片目录</button>
        <p class="side-note">MBTiles 暂不支持（后续版本）；COG / GeoTIFF 请用「打开数据」导入（按单幅贴图叠加、不做重投影）。</p>'''
new='''        <button id="btn-xyz-dir" class="wide" title="选择本地 XYZ 瓦片目录（…/z/x/y.png|jpg）">本地 XYZ 瓦片目录</button>
        <button id="btn-mbtiles" class="wide" title="加载本地 MBTiles（需先用 MaoMaoEarth.exe mbtiles 启动瓦片服务）">加载 MBTiles…</button>
        <p class="side-note">MBTiles：运行 <code>MaoMaoEarth.exe mbtiles 文件.mbtiles</code> 后会自动打开；也可手动填服务地址。COG / GeoTIFF 用「打开数据」导入。</p>'''
assert old in c, 'data section anchor missing'
c=c.replace(old,new,1)
old2='  <script src="js/snapshot.js"></script>\n  <script src="js/api.js"></script>'
new2='  <script src="js/snapshot.js"></script>\n  <script src="js/mbtiles.js"></script>\n  <script src="js/api.js"></script>'
assert old2 in c, 'script anchor missing'
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('index patched')
