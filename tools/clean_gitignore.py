p=r'G:\sh\local-earth\.gitignore'
lines=open(p,encoding='utf-8').read().splitlines()
out=[]
for l in lines:
    if 'MBTiles' in l or '鏈嶅姟' in l:  # drop malformed comment line
        continue
    if l.strip()=='.maomaoearth-mbtiles.state' and l in out:
        continue
    if l.strip()=='.maomaoearth-mbtiles.state.tok' and l in out:
        continue
    out.append(l)
if '.maomaoearth-mbtiles.state' not in out: out.append('.maomaoearth-mbtiles.state')
if '.maomaoearth-mbtiles.state.tok' not in out: out.append('.maomaoearth-mbtiles.state.tok')
open(p,'w',encoding='utf-8',newline='\n').write('\n'.join(out)+'\n')
print('gitignore cleaned')
