p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''          collection.add(new C.Polyline({
            positions: positions,
            width: Math.max(0.8, widthValue),
            material: material,
          }));'''
new='''          collection.add(new C.Polyline({
            positions: positions,
            width: Math.max(0.8, widthValue),
            material: material,
          }, collection));'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('Polyline collection ctor fixed')
