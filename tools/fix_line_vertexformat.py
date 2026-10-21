p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old="geometry: new C.PolylineGeometry({ positions: positions, width: widthValue }),"
new="geometry: new C.PolylineGeometry({ positions: positions, width: widthValue, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),"
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('vertexFormat added')
