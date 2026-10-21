p=r'G:\sh\local-earth\.gitignore'
c=open(p,encoding='utf-8').read()
c=c.rstrip('\n')+'\n.maomaoearth-mbtiles.state\n.maomaoearth-mbtiles.state.tok\n'
open(p,'w',encoding='utf-8',newline='\n').write(c)
print('gitignore fixed')
