import math, os, subprocess, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
ROOT=r'G:\sh\local-earth\data\public\imagery\s2cloudless'
BASE='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
def merc_y(lat):
    r=math.radians(lat); return (1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2
def tiles(z,w,s,e,n):
    N=2**z; x0=math.floor((w+180)/360*N); x1=math.floor((e+180)/360*N); y0=math.floor(merc_y(n)*N); y1=math.floor(merc_y(s)*N)
    return [(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)]
def fetch(z,x,y):
    p=os.path.join(ROOT,str(z),str(x),f'{y}.jpg')
    if os.path.exists(p) and os.path.getsize(p)>1500: return p
    os.makedirs(os.path.dirname(p),exist_ok=True)
    url=BASE.format(z=z,x=x,y=y)
    for _ in range(2):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'local-earth/1.0'})
            d=urllib.request.urlopen(req,timeout=60).read()
            if len(d)>1500 and d[:2]==b'\xff\xd8': open(p,'wb').write(d); return p
        except Exception: pass
    try:
        subprocess.run(['curl.exe','-L','-4','--retry','4','--retry-delay','2','--connect-timeout','20','-s','-o',p,url],timeout=180,check=False)
        if os.path.exists(p) and os.path.getsize(p)>1500: return p
    except Exception: pass
    return None
plan=[]
for z,(w,s,e,n) in [(9,(100,23,105,27)),(10,(100,23,105,27)),(11,(100,23,105,27)),(12,(101,24,104,26.5))]:
    t=tiles(z,w,s,e,n); print('z',z,'count',len(t),flush=True); plan.extend((z,x,y) for x,y in t)
print('total',len(plan),flush=True)
done=0; failed=[]
with ThreadPoolExecutor(max_workers=14) as pool:
    fut={pool.submit(fetch,z,x,y):(z,x,y) for z,x,y in plan}
    for f in as_completed(fut):
        if not f.result(): failed.append(fut[f])
        done+=1
        if done%200==0 or done==len(plan): print('done',done,'/',len(plan),'failed',len(failed),flush=True)
for z,x,y in failed: fetch(z,x,y)
print('finished',flush=True)
