p=r'G:\sh\local-earth\tools\cdp_kml_profile.mjs'
c=open(p,encoding='utf-8').read().replace('await sleep(50000);','await sleep(90000);')
open(p,'w',encoding='utf-8',newline='').write(c); print('wait 90s')
