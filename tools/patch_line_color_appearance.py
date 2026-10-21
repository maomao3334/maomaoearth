p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''          instances.push(new C.GeometryInstance({
            geometry: new C.PolylineGeometry({ positions: positions, width: widthValue, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),
            attributes: { color: new C.ColorGeometryInstanceAttribute(color) },
          }));'''
new='''          const colors = new Array(positions.length);
          for (let k = 0; k < colors.length; k++) colors[k] = color;
          instances.push(new C.GeometryInstance({
            geometry: new C.PolylineGeometry({
              positions: positions,
              width: widthValue,
              colors: colors,
              vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT,
            }),
          }));'''
assert old in c
c=c.replace(old,new,1)
old2='''        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),'''
new2='''        appearance: new C.PolylineColorAppearance({ translucent: true }),'''
assert old2 in c
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('switched to PolylineColorAppearance')
