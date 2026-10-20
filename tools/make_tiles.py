import math, os
from PIL import Image
src = Image.open(r'G:\sh\local-earth\data\samples\world.topo.bathy.200412.3x5400x2700.jpg').convert('RGB')
W,H = src.size
out_root = r'G:\sh\local-earth\data\samples\tiles'
os.makedirs(out_root, exist_ok=True)

def merc_to_lat(y, n):
    return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/n))))

for z in range(0,4):
    n = 2**z
    for x in range(n):
        for y in range(n):
            lon1 = x/n*360-180; lon2 = (x+1)/n*360-180
            lat1 = merc_to_lat(y, n); lat2 = merc_to_lat(y+1, n)
            px1 = int((lon1+180)/360*W); px2 = max(px1+1, int((lon2+180)/360*W))
            py1 = int((90-lat1)/180*H); py2 = max(py1+1, int((90-lat2)/180*H))
            crop = src.crop((max(0,px1), max(0,py1), min(W,px2), min(H,py2))).resize((256,256), Image.LANCZOS)
            d = os.path.join(out_root, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            crop.save(os.path.join(d, f'{y}.png'))
print('tiles generated')
