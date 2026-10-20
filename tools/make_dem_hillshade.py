import gzip, math, os, json
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
src=r'G:\sh\local-earth\data\public\dem\N25E102.hgt.gz'
out_dir=r'G:\sh\local-earth\data\public\dem'
raw=gzip.open(src,'rb').read()
n=int(math.sqrt(len(raw)//2))
print('hgt samples', n, 'bytes', len(raw))
dem=np.frombuffer(raw,dtype='>i2').reshape(n,n).astype(np.float32)
dem[dem < -1000] = np.nan
# SRTM tile N25E102: rows north->south (25..26? actually tile N25 covers 25-26N, first row is 26N)
# Compute gradients with correct spacing
lat_top, lon_left = 26.0, 102.0
step = 1.0/(n-1)
# replace NaN by local median for shading
filled = np.where(np.isnan(dem), np.nanmedian(dem), dem)
gy, gx = np.gradient(filled, step*111320.0)
az = math.radians(315.0); alt = math.radians(45.0)
slope = np.arctan(np.hypot(gx,gy))
aspect = np.arctan2(-gx, gy)
hs = np.sin(alt)*np.cos(slope) + np.cos(alt)*np.sin(slope)*np.cos(az-aspect)
hs = np.clip(hs,0,1)
# hypsometric tint
hmin,hmax = np.nanmin(filled), np.nanmax(filled)
t = np.clip((filled-hmin)/(hmax-hmin),0,1)
r = np.interp(t,[0,0.25,0.5,0.75,1],[40,90,140,190,245])
g = np.interp(t,[0,0.25,0.5,0.75,1],[90,130,150,175,245])
b = np.interp(t,[0,0.25,0.5,0.75,1],[60,80,90,120,245])
shade = 0.45 + 0.75*hs
rgb = np.stack([np.clip(r*shade,0,255),np.clip(g*shade,0,255),np.clip(b*shade,0,255)],axis=-1).astype(np.uint8)
alpha = np.full((n,n),230,dtype=np.uint8)
rgba=np.dstack([rgb,alpha])
img=Image.fromarray(rgba,'RGBA')
# flip vertically: SRTM first row is north, image y=0 is north -> already correct (top=north)
out_png=os.path.join(out_dir,'N25E102-hillshade.png')
img.resize((1024,1024),Image.LANCZOS).save(out_png)
meta={'name':'SRTM N25E102 地形阴影','source':'AWS Terrain Tiles / SRTM 90m (N25E102.hgt.gz)','bbox':[lon_left,25.0,103.0,26.0],'minHeight':float(hmin),'maxHeight':float(hmax),'image':'N25E102-hillshade.png','license':'SRTM (public domain, NASA/USGS); AWS Terrain Tiles'}
json.dump(meta, open(os.path.join(out_dir,'N25E102.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('elev range', hmin, hmax, 'out', out_png, os.path.getsize(out_png))
