from PIL import Image
im=Image.open(r'G:\sh\local-earth\docs\testdata\kml-native-wind3d.png').convert('RGB')
crop=im.crop((300,56,1280,770))
w,h=crop.size
px=crop.load()
cnt=0; samples=[]
for y in range(0,h,2):
    for x in range(0,w,2):
        r,g,b=px[x,y]
        mx=max(r,g,b); mn=min(r,g,b)
        if mx-mn>50 and mx>90:
            cnt+=1
            if len(samples)<10: samples.append((x,y,(r,g,b)))
print('viewer px sampled', (w//2)*(h//2), 'saturated', cnt)
print(samples)
