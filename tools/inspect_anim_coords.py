import zipfile, re
p=r'G:\sh\local-earth\data\samples\wind\anim.kmz'
d=zipfile.ZipFile(p).read('doc.kml').decode('utf-8','replace')
coords=re.findall(r'<coordinates>([^<]+)</coordinates>', d)
pts=[]
for c in coords:
    parts=c.strip().split(',')
    if len(parts)>=2:
        try: pts.append((float(parts[0]),float(parts[1])))
        except: pass
print('points',len(pts))
lons=[p[0] for p in pts]; lats=[p[1] for p in pts]
print('lon range',min(lons),max(lons),'uniq',len(set(round(x,6) for x in lons)))
print('lat range',min(lats),max(lats),'uniq',len(set(round(x,6) for x in lats)))
from collections import Counter
print('lat counts top', Counter(round(x,4) for x in lats).most_common(5))
print('lon counts top', Counter(round(x,4) for x in lons).most_common(5))
times=re.findall(r'<begin>([^<]+)</begin>', d)
print('time begin count', len(times), 'uniq', len(set(times)), sorted(set(times))[:5])
