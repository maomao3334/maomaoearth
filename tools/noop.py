p=r'G:\sh\local-earth\tools\cdp_visual3.mjs'
c=open(p,encoding='utf-8').read()
# Ensure close view at end (it already sets view). Keep.
open(p,'w',encoding='utf-8',newline='').write(c)
print('ok')
