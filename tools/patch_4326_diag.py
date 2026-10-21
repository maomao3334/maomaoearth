p=r'G:\sh\local-earth\tools\cdp_4326_diag.mjs'
c=open(p,encoding='utf-8').read()
c=c.replace("""  // hide others
  for(let i=0;i<layers.length;i++) layers.get(i).show=(layers.get(i)===m.imageryLayer);
  out.hidden=true;""","""  // raise to top and report
  layers.raiseToTop(m.imageryLayer);
  await new Promise(r=>setTimeout(r,800));
  out.mbIndex2=layers.indexOf(m.imageryLayer);
  out.topProvider=layers.get(layers.length-1).imageryProvider && layers.get(layers.length-1).imageryProvider.constructor;
  out.raised=true;""")
c=c.replace('mbtiles-4326-only.png','mbtiles-4326-raised.png')
open(p,'w',encoding='utf-8',newline='').write(c)
print('diag patched')
