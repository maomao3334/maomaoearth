import urllib.request, io
from PIL import Image
import numpy as np
def test(name,url):
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'local-earth/1.0'})
        data=urllib.request.urlopen(req,timeout=40).read()
        try:
            im=Image.open(io.BytesIO(data)); print(name,'bytes',len(data),'format',im.format,'size',im.size)
        except Exception as e:
            print(name,'bytes',len(data),'not image',str(e)[:80])
    except Exception as e:
        print(name,'FAIL',str(e)[:120])
test('s2 z6', 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/6/25/50.jpg')
test('s2 z7', 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/7/50/101.jpg')
test('terrarium z7','https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/101/50.png')
