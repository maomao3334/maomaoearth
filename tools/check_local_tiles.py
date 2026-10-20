import os
from PIL import Image
import numpy as np
root=r'G:\sh\local-earth\data\public\imagery\s2cloudless'
for z in [13,14]:
    d=os.path.join(root,str(z))
    files=[]
    for r,_,fs in os.walk(d):
        for f in fs: files.append(os.path.join(r,f))
    print('z',z,'files',len(files))
    for p in files[:3]:
        im=Image.open(p).convert('RGB'); a=np.asarray(im)
        print(' ',os.path.relpath(p,root), im.size, 'mean', a.mean(axis=(0,1)).round(1).tolist(), 'min',a.min(),'max',a.max())
