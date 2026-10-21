p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''      } else {
        const when = parseIsoTime(fastTagText(body, 'TimeStamp'));
        if (isFinite(when)) time = { begin: when, end: when, source: 'TimeStamp' };
      }'''
new='''      } else {
        const stamp = fastTagText(body, 'TimeStamp');
        const when = parseIsoTime(stamp ? fastTagText(stamp, 'when') : '');
        if (isFinite(when)) time = { begin: when, end: when, source: 'TimeStamp' };
      }'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
p2=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
d=open(p2,encoding='utf-8').read().replace('const string Version = "0.5.0";','const string Version = "0.5.1";',1)
open(p2,'w',encoding='utf-8',newline='').write(d)
p3=r'G:\sh\local-earth\js\api.js'
a=open(p3,encoding='utf-8').read().replace("version: '0.5.0'","version: '0.5.1'",1)
open(p3,'w',encoding='utf-8',newline='').write(a)
print('timestamp + version patched')
