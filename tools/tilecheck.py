import os, math
root=r'G:\sh\local-earth\data\public\imagery\s2cloudless'
def tilexy(lon,lat,z):
 n=2**z; x=int((lon+180.0)/360.0*n); lat=math.radians(lat); y=int((1.0-math.log(math.tan(lat)+1.0/math.cos(lat))/math.pi)/2.0*n); return x,y
for z in (10,11,12):
 x,y=tilexy(102.4,25.05,z)
 print('z',z,'x',x,'y',y)
 for xx in range(x-1,x+2):
  for yy in range(y-1,y+2):
   p=os.path.join(root,str(z),str(xx),str(yy)+'.jpg')
   print(z,xx,yy,os.path.exists(p), round(os.path.getsize(p)/1024,1) if os.path.exists(p) else '')
