import zipfile,re
p=r'G:\sh\local-earth\data\samples\wind\anim_timeline.kmz'
d=zipfile.ZipFile(p).read('doc.kml').decode('utf-8','replace')
coords=re.findall(r'<coordinates>([^<]+)</coordinates>',d)
lons=[];lats=[]
for c in coords:
    q=c.strip().split(',')
    if len(q)>=2:
        try: lons.append(float(q[0])); lats.append(float(q[1]))
        except: pass
print('points',len(lons))
print('lon',min(lons),max(lons),'uniq',len(set(round(x,5) for x in lons)))
print('lat',min(lats),max(lats),'uniq',len(set(round(x,5) for x in lats)))
times=re.findall(r'<begin>([^<]+)</begin>',d)
print('begin',len(times),'uniq',len(set(times)))
