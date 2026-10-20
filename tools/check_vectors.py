import json, os
d=r'G:\sh\local-earth\data\public\vectors'
for n in sorted(os.listdir(d)):
    p=os.path.join(d,n)
    try:
        with open(p,encoding='utf-8') as f: head=f.read(1)
        ok = head=='{'
        size=os.path.getsize(p)
        print(f'{n:55s} {size:>10d} json={ok}')
    except Exception as e:
        print(n,'ERR',e)
