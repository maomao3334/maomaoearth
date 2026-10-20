import urllib.request, io
from PIL import Image
import numpy as np
for z,x,y in [(5,16,12),(5,24,10)]:
    url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    req=urllib.request.Request(url, headers={'User-Agent':'local-earth-terrain/1.0'})
    data=urllib.request.urlopen(req,timeout=30).read()
    im=Image.open(io.BytesIO(data)).convert('RGB')
    a=np.asarray(im).astype(np.float32)
    h=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
    print(z,x,y,'bytes',len(data),'h',float(h.min()),float(h.max()),round(float(h.mean()),1))
