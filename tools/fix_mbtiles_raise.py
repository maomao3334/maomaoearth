p=r'G:\sh\local-earth\js\mbtiles.js'
c=open(p,encoding='utf-8').read()
old='''    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = 1.0;'''
new='''    const layer = viewer.imageryLayers.addImageryProvider(provider);
    try { viewer.imageryLayers.raiseToTop(layer); } catch (e) { /* ignore */ }
    layer.alpha = 1.0;'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('raiseToTop added')
