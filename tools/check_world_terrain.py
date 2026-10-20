import json, numpy as np
meta=json.load(open(r'G:\sh\local-earth\data\public\dem\world-terrain.json',encoding='utf-8'))
g=np.fromfile(r'G:\sh\local-earth\data\public\dem\world-terrain.bin',dtype='<i2').reshape(meta['height'],meta['width'])
def h(lon,lat):
    j=int(round((meta['north']-lat)/meta['resolutionDeg'])); i=int(round((lon-meta['west'])/meta['resolutionDeg']))
    return int(g[j,i])
for name,lon,lat in [('Everest',86.9,28.0),('Tibet',88.0,31.0),('Andes',-70.0,-20.0),('Alps',8.0,46.0),('Pacific',-150.0,0.0),('Atlantic',-30.0,30.0),('Beijing',116.4,39.9),('Kunming',102.83,24.88)]:
    print(f'{name:9s} ({lon},{lat}) => {h(lon,lat)} m')
