p=r'G:\sh\local-earth\js\mbtiles.js'
c=open(p,encoding='utf-8').read()
old='''    let provider;
    if (isVectorFormat(meta.format)) {
      provider = createVectorProvider(base, token, meta, tilingScheme, rectangle, minZ, maxZ);
    } else {'''
new='''    let provider;
    if (isVectorFormat(meta.format)) {
      if (window.LEMvt && typeof window.LEMvt.createImageryProvider === 'function') {
        provider = window.LEMvt.createImageryProvider({ base: base, token: token, meta: meta });
      } else {
        provider = createVectorProvider(base, token, meta, tilingScheme, rectangle, minZ, maxZ);
      }
    } else {'''
assert old in c, 'vector branch anchor missing'
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read().replace("version: '0.4.0'","version: '0.5.0'")
open(p2,'w',encoding='utf-8',newline='').write(a)
print('mbtiles LEMvt integration + api version')
