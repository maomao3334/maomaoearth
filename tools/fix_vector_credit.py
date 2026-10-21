p=r'G:\sh\local-earth\js\mbtiles.js'
c=open(p,encoding='utf-8').read()
old='''      hasAlphaChannel: true,
      credit: meta.attribution || 'MBTiles','''
new='''      hasAlphaChannel: true,
      credit: new C.Credit(meta.attribution || 'MBTiles'),'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('credit fixed')
