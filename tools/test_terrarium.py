import urllib.request, io
from PIL import Image
import numpy as np
url='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/202/101.png'
req=urllib.request.Request(url, headers={'User-Agent':'local-earth-terrain/1.0'})
data=urllib.request.urlopen(req, timeout=30).read()
print('bytes', len(data))
im=Image.open(io.BytesIO(data)).convert('RGB')
a=np.asarray(im).astype(np.float32)
h=a[:,:,0]*256 + a[:,:,1] + a[:,:,2]/256 - 32768
print('size', im.size, 'height min/max/mean', float(h.min()), float(h.max()), round(float(h.mean()),1))
print('sample center', float(h[128,128]))
