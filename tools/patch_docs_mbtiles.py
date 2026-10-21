p=r'G:\sh\local-earth\README.md'
c=open(p,encoding='utf-8').read()
c=c.replace('MaoMaoEarth.exe mbtiles "D:\\\\data\\\\china.mbtiles"','MaoMaoEarth.exe mbtiles "D:\\data\\china.mbtiles"')
c=c.replace('# 免安装启动器（.NET Framework，13 KB）','# 免安装启动器（.NET Framework，25 KB）')
c=c.replace('- [P2 验收](docs/P2-VERIFICATION.md)：粒子方向回归、风廓线、搜索、快照、P0/P1 回归','- [P2 验收](docs/P2-VERIFICATION.md)：粒子方向回归、风廓线、搜索、快照、P0/P1 回归\n- [MBTiles 说明与验证](docs/MBTILES.md)：本地 SQLite 瓦片服务、TMS、测试记录')
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\docs\PACKAGING.md'
d=open(p2,encoding='utf-8').read().replace('约 14 KB','约 25 KB')
open(p2,'w',encoding='utf-8',newline='').write(d)
print('README/PACKAGING patched')
