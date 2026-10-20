import gzip, math, json
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
src=r'G:\sh\local-earth\data\public\dem\N25E102.hgt.gz'
raw=gzip.open(src,'rb').read(); n=int(math.sqrt(len(raw)//2))
dem=np.frombuffer(raw,dtype='>i2').reshape(n,n).astype(np.float32)
dem[dem<-1000]=np.nan; dem=np.where(np.isnan(dem), np.nanmedian(dem), dem); dem=np.clip(dem,-500,9000)
step=1.0/(n-1); dy=step*111132.0; dx=step*111320.0*math.cos(math.radians(25.5))
gy,gx=np.gradient(dem,dy,dx)
az=math.radians(315.0); alt=math.radians(45.0)
slope=np.arctan(np.hypot(gx,gy)); aspect=np.arctan2(-gx,gy)
hs=np.clip(np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-aspect),0,1)
t=np.clip((dem-dem.min())/max(1.0,float(dem.max()-dem.min())),0,1)
r=np.interp(t,[0,0.2,0.45,0.7,1],[80,100,130,170,235]); g=np.interp(t,[0,0.2,0.45,0.7,1],[110,130,145,165,235]); b=np.interp(t,[0,0.2,0.45,0.7,1],[80,90,95,110,235])
shade=0.42+0.72*hs
rgb=np.stack([np.clip(r*shade,0,255),np.clip(g*shade,0,255),np.clip(b*shade,0,255)],axis=-1)
rgba=np.dstack([rgb.astype(np.uint8),np.full((n,n),255,dtype=np.uint8)])
Image.fromarray(rgba,'RGBA').resize((2048,2048),Image.LANCZOS).save(r'G:\sh\local-earth\data\public\dem\N25E102-hillshade.png',optimize=True)
print('hillshade 2048 written', __import__('os').path.getsize(r'G:\sh\local-earth\data\public\dem\N25E102-hillshade.png'))
