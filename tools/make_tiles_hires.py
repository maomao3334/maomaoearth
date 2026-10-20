import math, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src_path=r'G:\sh\local-earth\data\public\imagery\blue-marble-21600.jpg'
out_root=r'G:\sh\local-earth\data\public\tiles\blue-marble'
src=Image.open(src_path).convert('RGB')
W,H=src.size
print('source', W,H)
def merc_to_lat(y,n):
    return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/n))))
count=0
for z in range(0,6):
    n=2**z
    for x in range(n):
        lon1=x/n*360-180; lon2=(x+1)/n*360-180
        px1=int((lon1+180)/360*W); px2=max(px1+1,int((lon2+180)/360*W))
        for y in range(n):
            lat1=merc_to_lat(y,n); lat2=merc_to_lat(y+1,n)
            py1=int((90-lat1)/180*H); py2=max(py1+1,int((90-lat2)/180*H))
            crop=src.crop((max(0,px1),max(0,py1),min(W,px2),min(H,py2))).resize((256,256),Image.LANCZOS)
            d=os.path.join(out_root,str(z),str(x)); os.makedirs(d,exist_ok=True)
            crop.save(os.path.join(d,f'{y}.jpg'),quality=88)
            count+=1
print('tiles',count)
