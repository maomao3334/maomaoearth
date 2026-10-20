import io
p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read().replace('const string Version = "0.1.0";','const string Version = "0.3.0";')
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read().replace("version: '0.2.0'","version: '0.3.0'")
open(p2,'w',encoding='utf-8',newline='').write(a)
print('versions bumped')
