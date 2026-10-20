p=r'G:\sh\local-earth\js\importers.js'
c=open(p,encoding='utf-8').read()
old="""      } else if (/\\.geojson$|\\.json$/.test(lower)) {
        dataSource = await C.GeoJsonDataSource.load(url, {
          clampToGround: false,
          markerSize: 24,
          strokeWidth: 2,
        });
        sanitizePolylineDataSource(dataSource);
      } else {"""
new="""      } else if (/\\.geojson$|\\.json$/.test(lower)) {
        // 公共 Natural Earth 矢量：默认贴地渲染（clampToGround），国界只描边、湖泊淡蓝填充，
        // 避免高度 0 的面被 3D 地形遮成蓝色块；?drape=0 可关闭。
        const isPublicVector = /data\\/public\\/vectors\\//.test(url) || /ne_10m_(admin_0|rivers|lakes|populated_places)/.test(lower);
        const drape = isPublicVector && new URLSearchParams(location.search).get('drape') !== '0';
        const geoOptions = { clampToGround: drape, markerSize: 24, strokeWidth: 2 };
        if (isPublicVector) {
          if (/admin_0/.test(lower)) {
            geoOptions.stroke = C.Color.fromCssColorString('#86b7e8').withAlpha(0.9);
            geoOptions.strokeWidth = 1.2;
            geoOptions.fill = false;
          } else if (/rivers/.test(lower)) {
            geoOptions.stroke = C.Color.fromCssColorString('#4f9fd8').withAlpha(0.95);
            geoOptions.strokeWidth = 1.3;
          } else if (/lakes/.test(lower)) {
            geoOptions.fill = C.Color.fromCssColorString('#2f6f9f').withAlpha(0.35);
            geoOptions.stroke = C.Color.fromCssColorString('#5fa8d8').withAlpha(0.9);
            geoOptions.strokeWidth = 1.0;
          } else if (/populated_places/.test(lower)) {
            geoOptions.markerColor = C.Color.fromCssColorString('#ffd166').withAlpha(0.9);
            geoOptions.markerSize = 6;
          }
        }
        dataSource = await C.GeoJsonDataSource.load(url, geoOptions);
        sanitizePolylineDataSource(dataSource);
      } else {"""
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('patched')
else:
    print('pattern missing')
