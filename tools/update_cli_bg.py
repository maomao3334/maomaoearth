p=r'G:\sh\local-earth\docs\CLI.md'
c=open(p,encoding='utf-8').read()
c=c.replace(':: 启动本地 MBTiles 瓦片服务并打开应用（Ctrl+C 停止）',':: 后台启动本地 MBTiles 瓦片服务并打开应用（命令立即返回；stop 停止）')
old='''- `mbtiles <文件>` 会启动 C# 瓦片服务（winsqlite3.dll，127.0.0.1 随机端口 + token），
  并打开 `?mbtiles=<服务地址>&mbtoken=<token>`；启动器保持运行，Ctrl+C 停止瓦片服务。
  详见 [MBTILES.md](MBTILES.md)。'''
new='''- `mbtiles <文件>` 会后台启动 C# 瓦片服务（winsqlite3.dll，127.0.0.1 随机端口 + token），
  并打开 `?mbtiles=<服务地址>&mbtoken=<token>`；**命令立即返回，不需要保持窗口**。
  PID/端口/token 写入 `.maomaoearth-mbtiles.state`；`MaoMaoEarth.exe stop` 停止后台服务与静态服务。
  详见 [MBTILES.md](MBTILES.md)。'''
assert old in c, 'CLI block anchor missing'
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('CLI doc updated')
