p=r'G:\sh\local-earth\vendor\cesium\Cesium.js'
d=open(p,'rb').read()
for needle in [b'doc.kml', b'.kmz', b'ZipArchive', b'findKmlFile', b'endswith']:
    idx=[]; start=0
    while True:
        i=d.find(needle,start)
        if i<0: break
        idx.append(i); start=i+1
        if len(idx)>=5: break
    print(needle, 'count(first5)', len(idx))
    for i in idx[:3]:
        s=max(0,i-180); e=min(len(d),i+260)
        print('   ...', d[s:e].decode('utf-8','replace').replace('\n',' '))
