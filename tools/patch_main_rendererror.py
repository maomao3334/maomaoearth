p=r'G:\sh\local-earth\js\main.js'
c=open(p,encoding='utf-8').read()
old="""  const scene = viewer.scene;
  scene.globe.baseColor = C.Color.fromCssColorString('#0a1622');"""
new="""  const scene = viewer.scene;

  // 渲染循环异常时把完整堆栈打到控制台，便于定位（Cesium 默认只弹面板）
  try {
    scene.renderError.addEventListener(function (sc, error) {
      console.error('[Cesium renderError]', error && (error.stack || error.message || error));
    });
  } catch (err) {
    console.warn('renderError 监听失败', err);
  }

  scene.globe.baseColor = C.Color.fromCssColorString('#0a1622');"""
if old in c:
    c=c.replace(old,new)
    open(p,'w',encoding='utf-8',newline='').write(c)
    print('patched')
else:
    print('pattern not found')
