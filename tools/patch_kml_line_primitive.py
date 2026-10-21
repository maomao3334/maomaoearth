p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''    function buildFrame(index) {
      const collection = new C.PolylineCollection();
      const group = frameGroups[index] || [];
      for (const placemark of group) {
        if (!placemark.visible) continue;
        const lineStyle = placemark.style && placemark.style.line;
        const color = ((lineStyle && lineStyle.color) || C.Color.WHITE).withAlpha(0.95);
        const key = color.toCssColorString() + '|' + color.alpha;
        let material = materialCache.get(key);
        if (!material) {
          material = C.Material.fromType('Color', { color: color });
          materialCache.set(key, material);
        }
        const widthValue = lineWidthOf(placemark.style);
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'line' || !geometry.coords || geometry.coords.length < 2) continue;
          const clampToGround = geometry.altitudeMode === 'clampToGround' && !config.clampToGroundAsHeight;
          const altitudeMode = geometry.altitudeMode === 'clampToGround' && config.clampToGroundAsHeight
            ? 'relativeToGround'
            : geometry.altitudeMode;
          const positions = positionsFor(geometry.coords, altitudeMode);
          if (positions.length < 2) continue;
          collection.add(new C.Polyline({
            positions: positions,
            width: Math.max(0.8, widthValue),
            material: material,
          }, collection));
        }
      }
      return collection;
    }'''
new='''    function buildFrame(index) {
      const instances = [];
      const group = frameGroups[index] || [];
      for (const placemark of group) {
        if (!placemark.visible) continue;
        const lineStyle = placemark.style && placemark.style.line;
        const color = ((lineStyle && lineStyle.color) || C.Color.WHITE).withAlpha(0.95);
        const widthValue = Math.max(0.8, lineWidthOf(placemark.style));
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'line' || !geometry.coords || geometry.coords.length < 2) continue;
          const clampToGround = geometry.altitudeMode === 'clampToGround' && !config.clampToGroundAsHeight;
          const altitudeMode = geometry.altitudeMode === 'clampToGround' && config.clampToGroundAsHeight
            ? 'relativeToGround'
            : geometry.altitudeMode;
          const positions = positionsFor(geometry.coords, altitudeMode);
          if (positions.length < 2) continue;
          instances.push(new C.GeometryInstance({
            geometry: new C.PolylineGeometry({ positions: positions, width: widthValue }),
            attributes: { color: new C.ColorGeometryInstanceAttribute(color) },
          }));
        }
      }
      if (!instances.length) return null;
      return new C.Primitive({
        geometryInstances: instances,
        appearance: new C.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        asynchronous: false,
        releaseGeometryInstances: false,
      });
    }'''
assert old in c
c=c.replace(old,new,1)
old2='''    function prune() {
      while (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value;
        if (oldest === current) break;
        const old = cache.get(oldest);
        cache.delete(oldest);
        try { le.viewer.scene.primitives.remove(old); } catch (err) { /* ignore */ }
      }
    }

    function applyFrame(index) {
      const t0 = perfNow();
      if (active) {
        try { le.viewer.scene.primitives.remove(active); } catch (err) { /* ignore */ }
      }
      if (!cache.has(index)) cache.set(index, buildFrame(index));
      active = cache.get(index);
      current = index;
      if (visible) {
        try { le.viewer.scene.primitives.add(active); } catch (err) { /* ignore */ }
      }
      prune();'''
new2='''    function prune() {
      while (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value;
        if (oldest === current) break;
        const old = cache.get(oldest);
        cache.delete(oldest);
        try { le.viewer.scene.primitives.remove(old); } catch (err) { /* ignore */ }
      }
    }

    function applyFrame(index) {
      const t0 = perfNow();
      if (active) {
        try { active.show = false; } catch (err) { /* ignore */ }
      }
      if (!cache.has(index)) cache.set(index, buildFrame(index));
      active = cache.get(index);
      current = index;
      if (active) {
        try {
          if (!active.__leAttached) {
            le.viewer.scene.primitives.add(active);
            active.__leAttached = true;
          }
          active.show = visible;
        } catch (err) { /* ignore */ }
      }
      prune();'''
assert old2 in c
c=c.replace(old2,new2,1)
old3='''    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try { le.viewer.scene.primitives.remove(active); } catch (err) { /* ignore */ }
      if (visible) {
        try { le.viewer.scene.primitives.add(active); } catch (err) { /* ignore */ }
      }
    }'''
new3='''    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try { active.show = visible; } catch (err) { /* ignore */ }
    }'''
assert old3 in c
c=c.replace(old3,new3,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('line player switched to static Primitive')
