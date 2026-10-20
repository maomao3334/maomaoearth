p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
# add places visibility post-processing inside stylePublicVectorDataSource after loop
old="""      if (!isAdmin && !isLakes && e.polyline) {
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
  }"""
new="""      if (!isAdmin && !isLakes && e.polyline) {
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
    // 城市点：拉远时隐藏，避免几千个黄点铺满整屏（近景 ≤1200 km 才显示）
    if (/populated_places/.test(lower)) {
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        try {
          if (e.billboard) {
            e.billboard.distanceDisplayCondition = new C.DistanceDisplayCondition(0, 1200000);
          }
          if (e.label) {
            e.label.distanceDisplayCondition = new C.DistanceDisplayCondition(0, 1200000);
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
  }"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('places distance condition added')
else:
    print('pattern missing')
