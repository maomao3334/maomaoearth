p=r'G:\sh\local-earth\tools\cdp_mvt_test.mjs'
c=open(p,encoding='utf-8').read()
c=c.replace('1c279d25ed1e4994b32f8d5664508058','298513b1b65742b5b9667be709d40fba')
c=c.replace('mbtiles-vector-app.png','mbtiles-4326-app.png')
open(p,'w',encoding='utf-8',newline='').write(c)
print('test updated 4326')
