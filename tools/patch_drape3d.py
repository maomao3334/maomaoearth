p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
# add helper before style function
helper="""  /** 按当前地形高度把经纬度点抬高，得到贴地的 3D 折线坐标（不依赖 GroundPolyline，避免不渲染）。 */
  function drapePositions(positions) {
    const out = [];
    if (!positions) return out;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const c = C.Cartographic.fromCartesian(p);
      if (!c || !isFinite(c.longitude) || !isFinite(c.latitude)) continue;
      let h = 0;
      try {
        if (window.LE && typeof window.LE.heightAt === 'function') {
          h = window.LE.heightAt(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude)) || 0;
        }
      } catch (err) {
        h = 0;
      }
      out.push(C.Cartesian3.fromRadians(c.longitude, c.latitude, h + 2));
    }
    return out;
  }

"""
anchor="  /** 公共矢量后处理：国界只留描边、湖泊淡蓝填充"
if helper.strip() not in c:
    c=c.replace(anchor, helper+anchor,1)
# replace inside admin branch: use drape + arcType NONE
old="""                const strokeColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.95);
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
                }"""
new="""                const strokeColor = C.Color.fromCssColorString('#86b7e8').withAlpha(0.95);
                for (let r = 0; r < rings.length; r++) {
                  if (!rings[r] || rings[r].length < 2) continue;
                  const draped = drapePositions(rings[r]);
                  if (draped.length < 2) continue;
                  dataSource.entities.add({
                    polyline: {
                      positions: draped,
                      width: 1.6,
                      material: strokeColor,
                      clampToGround: false,
                      arcType: C.ArcType.NONE,
                    },
                  });
                }"""
if old in c:
    c=c.replace(old,new,1)
else:
    print('admin block pattern missing')
# add rivers draping: inside loop after polygon block? easier add a separate loop before function end.
old2="""      }
    }
  }

  function dataSourceOptions(le) {"""
new2="""      }
      if (!isAdmin && !isLakes && e.polyline) {
        try {
          const raw = e.polyline.positions && e.polyline.positions.getValue ? e.polyline.positions.getValue(now) : e.polyline.positions;
          const draped = drapePositions(raw);
          if (draped.length >= 2) {
            e.polyline.positions = draped;
            e.polyline.clampToGround = false;
            e.polyline.arcType = C.ArcType.NONE;
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  function dataSourceOptions(le) {"""
if old2 in c:
    c=c.replace(old2,new2,1)
else:
    print('tail pattern missing')
open(p,'w',encoding='utf-8',newline='').write(c)
print('drape 3D borders/rivers added')
