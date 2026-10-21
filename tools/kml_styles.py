import re
p=r'G:\weather_nowcasting\animation_demo\wind_animation.kml'
data=open(p,encoding='utf-8',errors='ignore').read(200000)
for m in re.finditer(r'<Style[^>]*>.*?</Style>',data,re.S):
 print(m.group(0)[:800]); print('---')
