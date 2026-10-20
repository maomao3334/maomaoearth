import sys
p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old="""      polygon: {
        hierarchy: new C.PolygonHierarchy(outer, holes),
        material: fillColor,
        perPositionHeight: !clamp,"""
new="""      polygon: {
        hierarchy: new C.PolygonHierarchy(outer, holes),
        material: fillColor,
        perPositionHeight: !clamp,
        // 避免 Cesium 默认 RHUMB 细分在大面（国家/区域轮廓）上算出非法数组而中断渲染
        arcType: C.ArcType.GEODESIC,"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('kml polygon patched')
else:
    print('pattern missing')
