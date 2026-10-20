import zipfile, os
src=r'C:\Users\A\Wind3D-migration-20261013\results_v111\自动下载 DEM Download Test\kmz\Wind3D_20240403T080600Z_200m_h050m.kmz'
out=r'G:\sh\local-earth\docs\testdata\wind\extracted'
os.makedirs(out, exist_ok=True)
z=zipfile.ZipFile(src)
for n in z.namelist():
    z.extract(n, out)
print('extracted', os.listdir(out))
kml=[n for n in os.listdir(out) if n.endswith('.kml')][0]
data=open(os.path.join(out,kml),encoding='utf-8').read()
print('placemarks', data.count('<Placemark>'))
print('has Region', '<Region>' in data)
print('region block head:')
i=data.find('<Region>'); print(data[i:i+400])
print('style urls:', {})
import re
print('styleUrl values', set(re.findall(r'<styleUrl>([^<]+)', data)))
print('tail:'); print(data[-800:])
