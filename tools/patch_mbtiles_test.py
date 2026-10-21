p=r'G:\sh\local-earth\tools\cdp_mbtiles_test.mjs'
c=open(p,encoding='utf-8').read()
c=c.replace("6b147fb9e5654fd1b43d3c0689db2d11","b794a68e390d4120a280ebdaf2f5eb32")
c=c.replace("127.0.0.1:8127","127.0.0.1:8128")
c=c.replace("mbtiles-app.png","mbtiles-app-v040.png")
open(p,'w',encoding='utf-8',newline='').write(c)
print('test script updated')
