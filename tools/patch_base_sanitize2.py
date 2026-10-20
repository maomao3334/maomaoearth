p=r'G:\sh\local-earth\js\main.js'
c=open(p,encoding='utf-8').read()
c=c.replace("      );\n      countries.name = '国界（Natural Earth）';","      );\n      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {\n        LEImports.sanitizeDataSource(countries);\n      }\n      countries.name = '国界（Natural Earth）';",1)
c=c.replace("      );\n      places.show = false;","      );\n      if (window.LEImports && typeof LEImports.sanitizeDataSource === 'function') {\n        LEImports.sanitizeDataSource(places);\n      }\n      places.show = false;",1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('sanitize calls:', c.count('sanitizeDataSource'))
