import re, os
base=r'G:\sh\local-earth\docs\testdata\wind\extracted'
d=open(os.path.join(base,'wind_absolute.kml'),encoding='utf-8').read()
print('visibility tags', d.count('<visibility>'))
print('regions', d.count('<Region>'))
print('folders', d.count('<Folder>'), 'placemarks', d.count('<Placemark>'))
# 前 3 个 Placemark 提取，构造 mini KML，保留 styles
head=d[:d.find('<Folder>')]
pm=re.findall(r'<Placemark>.*?</Placemark>', d, flags=re.S)[:3]
mini=head + '<Folder><name>mini</name>' + ''.join(pm) + '</Folder></Document></kml>'
open(os.path.join(base,'wind_mini.kml'),'w',encoding='utf-8').write(mini)
print('mini len', len(mini), 'first placemark name', re.search(r'<name>([^<]*)</name>', pm[0]).group(1))
# 打印第一个 Placemark 的样式与坐标
print(pm[0][:700])
