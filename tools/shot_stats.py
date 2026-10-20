from PIL import Image
im=Image.open(r'G:\sh\local-earth\docs\testdata\screenshot-kmz-fit.png').convert('RGB')
# viewer area approx x 300..1280, y 56..690
crop=im.crop((300,56,1280,690))
px=list(crop.getdata())
sat=0
for r,g,b in px[::7]:
    mx=max(r,g,b); mn=min(r,g,b)
    if mx-mn>60 and mx>80: sat+=1
print('sampled',len(px[::7]),'saturated-ish',sat)
# unique-ish colors sample
from collections import Counter
c=Counter(px[::97])
print(c.most_common(8))
