import zipfile, os, sys
from lxml import etree
paths=[]
paths.append(('kmz',r'G:\weather_nowcasting\animation_demo\wind_animation_timeline.kmz'))
paths.append(('kml',r'G:\weather_nowcasting\animation_demo\wind_animation.kml'))
for kind,p in paths:
    print('===',kind,p)
    if kind=='kmz':
        z=zipfile.ZipFile(p); data=z.read('doc.kml')
    else:
        data=open(p,'rb').read()
    print('bytes',len(data))
    root=etree.fromstring(data)
    tags={}
    for el in root.iter():
        t=el.tag.split('}')[-1]; tags[t]=tags.get(t,0)+1
    for k in sorted(tags, key=lambda x:-tags[x])[:25]: print(k,tags[k])
    # sample placemark children
    n=0
    for pm in root.iter():
        if pm.tag.split('}')[-1]=='Placemark':
            print('PLACEMARK sample children:', [c.tag.split('}')[-1] for c in pm][:12])
            for c in pm:
                if c.tag.split('}')[-1] in ('Point','LineString','Polygon','MultiGeometry','TimeSpan','TimeStamp'):
                    print('  child',c.tag.split('}')[-1], etree.tostring(c,encoding='unicode')[:500].replace('\n',' '))
            n+=1
            if n>=2: break
