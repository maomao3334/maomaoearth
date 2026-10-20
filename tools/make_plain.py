import re, os
base=r'G:\sh\local-earth\docs\testdata\wind\extracted'
d=open(os.path.join(base,'wind_absolute.kml'),encoding='utf-8').read()
# 去掉 ScreenOverlay 两个块
d2=re.sub(r'<ScreenOverlay>.*?</ScreenOverlay>', '', d, flags=re.S)
# 去掉所有 styleUrl，改为内联红色线
d2=re.sub(r'<styleUrl>#[^<]+</styleUrl>', '<Style><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>', d2)
p=os.path.join(base,'wind_plain.kml')
open(p,'w',encoding='utf-8').write(d2)
print('wrote', p, len(d2), 'screenoverlays left', d2.count('<ScreenOverlay>'))
