p=r'G:\sh\local-earth\index.html'
c=open(p,encoding='utf-8').read()
old='  <script src="js/exporter.js"></script>\n  <script src="js/main.js"></script>'
new='  <script src="js/exporter.js"></script>\n  <script src="js/api.js"></script>\n  <script src="js/main.js"></script>'
if old in c:
    c=c.replace(old,new,1); open(p,'w',encoding='utf-8',newline='').write(c); print('api.js script tag added')
else:
    print('pattern missing')
