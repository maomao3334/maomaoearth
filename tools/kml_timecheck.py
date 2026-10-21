import zipfile, os, re, collections
p=r'G:\weather_nowcasting\animation_demo\wind_animation.kml'
data=open(p,'rb').read().decode('utf-8','ignore')
begins=re.findall(r'<begin>([^<]+)</begin>',data)
print('begin count',len(begins),'unique',len(set(begins)))
print(collections.Counter(begins).most_common(5))
folders=re.findall(r'<Folder>',data); print('folders',len(folders))
# first folder names
for m in re.finditer(r'<Folder>\s*<name>([^<]*)</name>',data):
 print('folder',m.group(1));
 if m.start()>500000: break
