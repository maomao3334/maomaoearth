# CLI doc
p=r'G:\sh\local-earth\docs\CLI.md'
c=open(p,encoding='utf-8').read()
old=''':: 导入 WindNinja/Wind3D 结果目录并打开
MaoMaoEarth.exe windninja "C:\\path\\to\\windninja\\...\\r0200m"'''
new=''':: 导入 WindNinja/Wind3D 结果目录并打开
MaoMaoEarth.exe windninja "C:\\path\\to\\windninja\\...\\r0200m"

:: 启动本地 MBTiles 瓦片服务并打开应用（Ctrl+C 停止）
MaoMaoEarth.exe mbtiles "D:\\data\\china.mbtiles"'''
if old in c: c=c.replace(old,new,1)
else: print('CLI command anchor missing')
old2='''maomaoearth windninja "D:\\Wind3D\\results\\case\\windninja\\20240403T080600Z\\h050m\\r0200m"'''
new2=old2+'''\nmaomaoearth mbtiles "D:\\data\\china.mbtiles"'''
if old2 in c: c=c.replace(old2,new2,1)
old3='''- `windninja <目录>` 会把目录中的 `*.asc` / `*.prj` / `*.cfg` / `*.csv` 复制到
  `data/samples/windninja/cli-<时间>-<目录名>/`，然后用
  `?windninja=<vel.asc>` 打开应用；原目录不被修改。'''
new3=old3+'''

- `mbtiles <文件>` 会启动 C# 瓦片服务（winsqlite3.dll，127.0.0.1 随机端口 + token），
  并打开 `?mbtiles=<服务地址>&mbtoken=<token>`；启动器保持运行，Ctrl+C 停止瓦片服务。
  详见 [MBTILES.md](MBTILES.md)。'''
if old3 in c: c=c.replace(old3,new3,1)
else: print('CLI behavior anchor missing')
open(p,'w',encoding='utf-8',newline='').write(c)

# API doc
p2=r'G:\sh\local-earth\docs\API.md'
a=open(p2,encoding='utf-8').read()
add='''

## MBTiles（v0.4.0）

```js
// 先运行 MaoMaoEarth.exe mbtiles <file>，从终端复制服务地址与 token
const info = await MaoMaoEarth.mbtiles.load('http://127.0.0.1:8140', 'TOKEN');
MaoMaoEarth.mbtiles.getState();
MaoMaoEarth.mbtiles.clear();
```

底层对象：`LEMBTiles`（`load/clear/getState/openDialog`）。
详见 [MBTILES.md](MBTILES.md)。
'''
if '## MBTiles（v0.4.0）' not in a: a += add
open(p2,'w',encoding='utf-8',newline='').write(a)
print('CLI/API docs updated')
