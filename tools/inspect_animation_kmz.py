import zipfile, os, re
files=[r'G:\weather_nowcasting\demo_project\wind_animation.kmz', r'G:\weather_nowcasting\demo_project\wind_animation_fixed.kmz', r'G:\weather_nowcasting\animation_demo\wind_animation_timeline.kmz']
for p in files:
    print('='*80); print(p, os.path.getsize(p) if os.path.exists(p) else 'MISSING')
    if not os.path.exists(p): continue
    z=zipfile.ZipFile(p)
    print('entries:', [(i.filename,i.file_size) for i in z.infolist()][:12])
    for n in z.namelist():
        if n.lower().endswith('.kml'):
            d=z.read(n).decode('utf-8','replace')
            print('KML', n, 'len', len(d))
            print('Placemark', d.count('<Placemark>'), 'Point', d.count('<Point>'), 'LineString', d.count('<LineString>'), 'Style', d.count('<Style'))
            print('styleUrls', sorted(set(re.findall(r'<styleUrl>#?([^<]+)', d)))[:10])
            print('ScreenOverlay', d.count('<ScreenOverlay>'), 'GroundOverlay', d.count('<GroundOverlay>'))
            i=d.find('<Style'); print('STYLE HEAD:', d[i:i+500].replace('\n',' ')[:500])
            j=d.find('<Placemark'); print('PLACEMARK HEAD:', d[j:j+600].replace('\n',' ')[:600])
            break
