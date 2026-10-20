import zipfile, sys, os
p = r'C:\Users\A\Wind3D-migration-20261013\results_v111\自动下载 DEM Download Test\kmz\Wind3D_20240403T080600Z_200m_h050m.kmz'
print('exists', os.path.exists(p), 'size', os.path.getsize(p))
z = zipfile.ZipFile(p)
print('entries:')
for i in z.infolist():
    print('  %-70s %8d' % (i.filename, i.file_size))
for name in z.namelist():
    if name.lower().endswith('.kml'):
        data = z.read(name).decode('utf-8', 'replace')
        print('=== KML', name, 'len', len(data), '===')
        print(data[:4000])
