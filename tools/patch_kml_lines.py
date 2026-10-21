p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
# 1) insert line frame player before timeline controller
anchor='  function createTimelineController(displayName, frames, applyFrame) {'
line_player=r'''
  /**
   * 超大“线”动画播放器：每条 LineString 用 Csysium.PolylineCollection 渲染（比 3 万 Entity 轻得多）。
   * 每帧一个 PolylineCollection，按需构建并缓存少量帧；切帧只把 collection 换入/换出 scene。
   */
  function createLineFrameAnimation(le, frames, frameGroups) {
    const cache = new Map();
    const cacheLimit = Math.max(1, Number(config.pointCloudCacheFrames) || 3);
    const materialCache = new Map();
    let active = null;
    let current = -1;
    let visible = true;

    function buildFrame(index) {
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
          }));
        }
      }
      return collection;
    }

    function prune() {
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
      prune();
      const ms = perfNow() - t0;
      perfStats.frameSwitchCount++;
      perfStats.lastFrameSwitchMs = Math.round(ms * 10) / 10;
      if (ms > perfStats.maxFrameSwitchMs) perfStats.maxFrameSwitchMs = Math.round(ms * 10) / 10;
      perfLog('frame-lines', {
        frame: index,
        ms: Math.round(ms * 10) / 10,
        sourceLines: (frameGroups[index] || []).length,
        cached: cache.size,
      });
    }

    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try {
        if (visible) le.viewer.scene.primitives.add(active);
        else le.viewer.scene.primitives.remove(active);
      } catch (err) { /* ignore */ }
    }

    function dispose() {
      for (const collection of cache.values()) {
        try { le.viewer.scene.primitives.remove(collection); } catch (err) { /* ignore */ }
      }
      cache.clear();
      materialCache.clear();
      active = null;
    }

    return {
      applyFrame,
      applyQuality: function () {},
      setVisible,
      dispose,
      get count() { return active ? active.length : 0; },
      get sourceCount() {
        const found = frameGroups[current] || [];
        let n = 0;
        for (const pm of found) n += pm.geometries.length;
        return n;
      },
      get currentFrame() { return current; },
    };
  }

'''
assert anchor in c
c=c.replace(anchor,line_player+anchor,1)
# 2) detection after primitiveMode block
anchor2='''      if (primitiveMode) windowMode = false;
    }

    let primitives = null;'''
new2='''      if (primitiveMode) windowMode = false;
    }

    // 超大动画若全是 LineString：改用 PolylineCollection 帧播放器（避免数万 Entity）。
    let primitiveLineMode = false;
    if (windowMode) {
      primitiveLineMode = true;
      let checked = 0;
      for (const placemark of model.placemarks) {
        if (!placemark.visible) continue;
        for (const geometry of placemark.geometries) {
          if (geometry.type !== 'line') { primitiveLineMode = false; break; }
        }
        if (!primitiveLineMode) break;
        checked++;
        if (checked % 20000 === 0) {
          await yieldToMain();
          perfStats.yieldCount++;
        }
      }
      if (primitiveLineMode) windowMode = false;
    }

    let primitives = null;'''
assert anchor2 in c
c=c.replace(anchor2,new2,1)
# 3) create line player after point primitives creation block
anchor3='''    if (primitiveMode) {
      try {
        primitives = createPointFrameAnimation(le, frames, frameGroups);
        progress.report('build', 86);
      } catch (err) {
        primitives = null;
        primitiveMode = false;
        windowMode = true;
        ctx.warn('点云动画初始化失败，已回退实体窗口模式：' + (err && err.message ? err.message : err));
      }
    }
'''
new3=anchor3+'''
    let linePrimitives = null;
    if (primitiveLineMode) {
      try {
        linePrimitives = createLineFrameAnimation(le, frames, frameGroups);
        progress.report('build', 86);
      } catch (err) {
        linePrimitives = null;
        primitiveLineMode = false;
        windowMode = true;
        ctx.warn('线动画初始化失败，已回退实体窗口模式：' + (err && err.message ? err.message : err));
      }
    }
'''
assert anchor3 in c
c=c.replace(anchor3,new3,1)
# 4) build condition
c=c.replace('if (!windowMode && !primitiveMode) {','if (!windowMode && !primitiveMode && !primitiveLineMode) {',1)
# 5) frame controls branch
anchor5='''    if (animated) {
      if (primitiveMode && primitives) {
        frameControls = function applyFramePrimitives(index) {
          primitives.applyFrame(index);
        };
      } else if (!windowMode) {'''
new5='''    if (animated) {
      if (primitiveLineMode && linePrimitives) {
        frameControls = function applyFrameLines(index) {
          linePrimitives.applyFrame(index);
        };
      } else if (primitiveMode && primitives) {
        frameControls = function applyFramePrimitives(index) {
          primitives.applyFrame(index);
        };
      } else if (!windowMode) {'''
assert anchor5 in c
c=c.replace(anchor5,new5,1)
# 6) rendered count + meta fields + visibility/dispose
c=c.replace('const renderedCount = windowMode || primitiveMode ? totalGeometries : entityCount;','const renderedCount = windowMode || primitiveMode || primitiveLineMode ? totalGeometries : entityCount;',1)
c=c.replace('if (primitives) {\n        primitives.visible = visible;','if (linePrimitives) linePrimitives.setVisible(visible);\n      if (primitives) {\n        primitives.visible = visible;',1)
c=c.replace('if (primitives) primitives.dispose();','if (primitives) primitives.dispose();\n      if (linePrimitives) linePrimitives.dispose();',1)
# meta add primitiveLineAnimation
c=c.replace('primitiveAnimation: primitiveMode,\n        pointSubsample:','primitiveAnimation: primitiveMode,\n        primitiveLineAnimation: primitiveLineMode,\n        pointSubsample:',1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('line frame player inserted')
