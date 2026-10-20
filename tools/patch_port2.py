p=r'G:\sh\local-earth\tools\cdp_final_verify.mjs'
c=open(p,encoding='utf-8').read().replace('9334','9335')
open(p,'w',encoding='utf-8',newline='').write(c)
print('port updated')
