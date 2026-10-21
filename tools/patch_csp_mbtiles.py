p=r'G:\sh\local-earth\index.html'
c=open(p,encoding='utf-8').read()
old="img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:;"
new="img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:; connect-src 'self' blob: data: http://127.0.0.1:* http://localhost:*;"
assert old in c, 'csp anchor missing'
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('CSP patched')
