import json, numpy as np
meta=json.load(open(r'G:\sh\local-earth\data\public\dem\china-terrain.json',encoding='utf-8'))
print(json.dumps(meta,ensure_ascii=False)[:400])
g=np.fromfile(r'G:\sh\local-earth\data\public\dem\china-terrain.bin',dtype='<i2').reshape(meta['height'],meta['width'])
def h(lon,lat):
    j=int(round((meta['north']-lat)/meta['resolutionDeg'])); i=int(round((lon-meta['west'])/meta['resolutionDeg']))
    return int(g[j,i])
for name,lon,lat,exp in [('Beijing',116.4,39.9,44),('Lhasa',91.1,29.65,3650),('Chengdu',104.07,30.67,500),('Shanghai',121.47,31.23,4),('Urumqi',87.6,43.8,800),('Everest',86.93,27.99,8848),('Kunming',102.83,24.88,1890)]:
    print(f'{name:9s} ({lon},{lat}) => {h(lon,lat)} m (expect ~{exp})')
