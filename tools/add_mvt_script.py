p=r'G:\sh\local-earth\index.html'
c=open(p,encoding='utf-8').read()
old='  <script src="js/mbtiles.js"></script>\n  <script src="js/api.js"></script>'
new='  <script src="js/mvt.js"></script>\n  <script src="js/mbtiles.js"></script>\n  <script src="js/api.js"></script>'
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('mvt script tag added')
else: print('anchor missing')
