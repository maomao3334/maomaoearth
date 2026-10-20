import gzip, math, json, os
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
src=r'G:\sh\local-earth\data\public\dem\N25E102.hgt.gz'
out_dir=r'G:\sh\local-earth\data\public\dem'
raw=gzip.open(src,'rb').read()
n=int(math.sqrt(len(raw)//2))
dem=np.frombuffer(raw,dtype='>i2').reshape(n,n).astype(np.float32)
dem[dem<-1000]=np.nan
med=float(np.nanmedian(dem))
dem=np.where(np.isnan(dem), med, dem)
# 1025 x 1025 (覆盖 1° x 1°，约 108 m/像素)
out_n=1025
img=Image.fromarray(dem, mode='F').resize((out_n,out_n), Image.BILINEAR)
arr=np.asarray(img).astype(np.float32)
arr=np.clip(arr, -500, 8000)
i16=np.round(arr).astype('<i2')
bin_path=os.path.join(out_dir,'N25E102-terrain.bin')
i16.tofile(bin_path)
meta={
  'name':'SRTM N25E102 terrain heightmap',
  'source':'AWS Terrain Tiles / SRTM 1 arc-second (N25E102.hgt.gz)',
  'bbox':[102.0,25.0,103.0,26.0],
  'west':102.0,'south':25.0,'east':103.0,'north':26.0,
  'width':out_n,'height':out_n,
  'rowOrder':'north-to-south',
  'scale':1.0,'offset':0.0,'dtype':'int16-le',
  'minHeight':float(np.nanmin(arr)),'maxHeight':float(np.nanmax(arr)),
  'file':'N25E102-terrain.bin',
  'license':'SRTM (public domain, NASA/USGS); AWS Terrain Tiles'
}
json.dump(meta, open(os.path.join(out_dir,'N25E102-terrain.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
print('bin bytes', os.path.getsize(bin_path), 'elev', meta['minHeight'], meta['maxHeight'])
