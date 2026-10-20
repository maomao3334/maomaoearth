p=r'G:\sh\local-earth\tools\cdp_final_verify.mjs'
c=open(p,encoding='utf-8').read()
c=c.replace('cam=102.40,25.02,9000,-60','cam=91,31,12000,-55')
open(p,'w',encoding='utf-8',newline='').write(c)
print('url updated')
