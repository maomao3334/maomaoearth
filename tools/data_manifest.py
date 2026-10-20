import hashlib, os, json
root=r'G:\sh\local-earth\data'
rows=[]
for dirpath, dirnames, filenames in os.walk(root):
    for fn in filenames:
        p=os.path.join(dirpath,fn)
        rel=os.path.relpath(p, root)
        h=hashlib.sha256(open(p,'rb').read()).hexdigest()
        rows.append({'path':rel.replace('\\','/'),'bytes':os.path.getsize(p),'sha256':h})
rows.sort(key=lambda r:r['path'])
open(r'G:\sh\local-earth\docs\data-manifest.json','w',encoding='utf-8').write(json.dumps(rows,ensure_ascii=False,indent=1))
total=sum(r['bytes'] for r in rows)
print('files',len(rows),'bytes',total)
for r in rows:
    if not r['path'].startswith('samples/tiles/'):
        print('%-70s %10d %s'%(r['path'],r['bytes'],r['sha256'][:16]))
