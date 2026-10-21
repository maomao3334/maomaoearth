p=r'G:\sh\local-earth\js\main.js'
c=open(p,encoding='utf-8').read()
old='''      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
        LEImports.sanitizeDataSource(countries);
      }
      countries.name = '国界（Natural Earth）';'''
new='''      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {
        LEImports.sanitizeDataSource(countries);
      }
      // 国界只描边：显式关闭 polygon 填充，避免低画质/无地形时 GeoJSON 默认白色面盖住底图
      try {
        const ents = countries.entities.values;
        for (let i = 0; i < ents.length; i++) {
          const polygon = ents[i].polygon;
          if (!polygon) continue;
          polygon.fill = false;
          polygon.material = C.Color.TRANSPARENT;
          polygon.outline = true;
        }
      } catch (err) {
        /* ignore */
      }
      countries.name = '国界（Natural Earth）';'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('country fill disabled')
