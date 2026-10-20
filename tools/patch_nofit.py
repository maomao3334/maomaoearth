p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
old="""      if (!fitDataSource(le, dataSource)) {
        await le.viewer.flyTo(dataSource, { duration: 1.2 }).catch(() => {});
      }
      if (window.LETools"""
new="""      // 不再在导入后自动把相机飞到数据范围（加载公共图层会跳回全球视角）；
      // 需要定位时用图层列表的“定位”按钮（zoomTo）或 ?fit=1。
      if (new URLSearchParams(location.search).get('fit') === '1') {
        if (!fitDataSource(le, dataSource)) {
          await le.viewer.flyTo(dataSource, { duration: 1.2 }).catch(() => {});
        }
      }
      if (window.LETools"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('auto-fit disabled')
else:
    print('pattern missing')
