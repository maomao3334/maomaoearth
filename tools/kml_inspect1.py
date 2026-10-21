import zipfile, os
p=r'G:\weather_nowcasting\animation_demo\wind_animation_timeline.kmz'
z=zipfile.ZipFile(p)
for i in z.infolist(): print(i.filename, i.file_size)
