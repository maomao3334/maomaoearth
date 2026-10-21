p=r'G:\sh\local-earth\js\terrain.js'
c=open(p,encoding='utf-8').read()
old='''      tileWidth: 256,
      tileHeight: 256,
      credit: IMAGERY_CREDIT,
    });'''
new='''      tileWidth: 256,
      tileHeight: 256,
      // 数据覆盖外/缺失的 JPEG 瓦片按透明处理，避免在蓝马赛克底图上出现白色方块
      hasAlphaChannel: true,
      credit: IMAGERY_CREDIT,
    });'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('S2 hasAlphaChannel patched')
