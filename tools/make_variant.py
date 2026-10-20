import re, os
base=r'G:\sh\local-earth\docs\testdata\wind\extracted'
name=[n for n in os.listdir(base) if n.endswith('.kml')][0]
p=os.path.join(base,name)
d=open(p,encoding='utf-8').read()
no_region=re.sub(r'<Region>.*?</Region>', '', d, flags=re.S)
out=os.path.join(base,'wind_noregion.kml')
open(out,'w',encoding='utf-8').write(no_region)
print('wrote', out, len(no_region), 'region removed', '<Region>' not in no_region)
