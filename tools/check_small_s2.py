import os
from PIL import Image
d=r'G:\sh\local-earth\data\public\imagery\s2cloudless'
small=[]
for root,_,files in os.walk(d):
    for fn in files:
        p=os.path.join(root,fn)
        if os.path.getsize(p)<=2000: small.append(p)
print('small files',len(small))
from collections import Counter
c=Counter()
for p in small[:50]:
    try:
        im=Image.open(p); c[(im.size,im.mode)]+=1
    except Exception as e:
        c[('ERR',str(e)[:40])]+=1
print(c.most_common(5))
if small:
    p=small[0]; print('sample',p,os.path.getsize(p)); im=Image.open(p); print(im.size, im.mode)
