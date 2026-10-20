p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
old="""          if (isAdmin) {
            e.polygon.material = C.Color.TRANSPARENT;
            e.polygon.outline = true;
            e.polygon.outlineColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.9);
            e.polygon.outlineWidth = 1.2;
          } else if (isLakes) {"""
new="""          if (isAdmin) {
            // 贴地面的多边形轮廓在 GroundPrimitive 上不一定渲染：转成贴地折线（GroundPolyline）
            try {
              const hierarchy = e.polygon.hierarchy.getValue ? e.polygon.hierarchy.getValue(now) : e.polygon.hierarchy;
              if (hierarchy && hierarchy.positions) {
                const rings = [hierarchy.positions];
                if (hierarchy.holes) for (let h = 0; h < hierarchy.holes.length; h++) rings.push(hierarchy.holes[h].positions);
                const strokeColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.95);
                for (let r = 0; r < rings.length; r++) {
                  if (!rings[r] || rings[r].length < 2) continue;
                  dataSource.entities.add({
                    polyline: {
                      positions: rings[r],
                      width: 1.6,
                      material: strokeColor,
                      clampToGround: true,
                    },
                  });
                }
                e.show = false;
              }
            } catch (err) {
              /* ignore */
            }
          } else if (isLakes) {"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('admin borders -> ground polylines')
else:
    print('pattern missing')
