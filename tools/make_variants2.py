import os
base=r'G:\sh\local-earth\docs\testdata\wind\extracted'
src=os.path.join(base,'wind_noregion.kml')
d=open(src,encoding='utf-8').read()
for mode,tag in [('absolute','absolute'),('clamp','clampToGround')]:
    out=d.replace('<altitudeMode>relativeToGround</altitudeMode>', f'<altitudeMode>{tag}</altitudeMode>')
    p=os.path.join(base, f'wind_{mode}.kml')
    open(p,'w',encoding='utf-8').write(out)
    print(p, len(out))
