import gzip, math, os, json
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
src=r'G:\sh\local-earth\data\public\dem\N25E102.hgt.gz'
out_dir=r'G:\sh\local-earth\data\public\dem'
raw=gzip.open(src,'rb').read()
n=int(math.sqrt(len(raw)//2))
dem=np.frombuffer(raw,dtype='>i2').reshape(n,n).astype(np.float32)
dem[dem<-1000]=np.nan
filled=np.where(np.isnan(dem), np.nanmedian(dem), dem)
step=1.0/(n-1)
gy,gx=np.gradient(filled, step*111320.0)
az=math.radians(315.0); alt=math.radians(45.0)
slope=np.arctan(np.hypot(gx,gy)); aspect=np.arctan2(-gx,gy)
hs=np.clip(np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-aspect),0,1)
hmin,hmax=np.nanmin(filled),np.nanmax(filled)
t=np.clip((filled-hmin)/(hmax-hmin),0,1)
r=np.interp(t,[0,0.25,0.5,0.75,1],[40,90,140,190,245])
g=np.interp(t,[0,0.25,0.5,0.75,1],[90,130,150,175,245])
b=np.interp(t,[0,0.25,0.5,0.75,1],[60,80,90,120,245])
shade=0.45+0.75*hs
rgb=np.stack([np.clip(r*shade,0,255),np.clip(g*shade,0,255),np.clip(b*shade,0,255)],axis=-1).astype(np.uint8)
# 完全不透明 alpha=255，避免与底图黑色像素混合
alpha=np.full((n,n),255,dtype=np.uint8)
rgba=np.dstack([rgb,alpha])
img=Image.fromarray(rgba,'RGBA')
out_png=os.path.join(out_dir,'N25E102-hillshade.png')
img.resize((2048,2048),Image.LANCZOS).save(out_png)
meta=json.load(open(os.path.join(out_dir,'N25E102.json'),encoding='utf-8'))
meta['hillshadeSize']=2048; meta['hillshadeAlpha']=255
json.dump(meta, open(os.path.join(out_dir,'N25E102.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('wrote', out_png, os.path.getsize(out_png))
