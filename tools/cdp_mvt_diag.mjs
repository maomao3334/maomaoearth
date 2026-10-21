import fs from 'node:fs';
const CDP='http://127.0.0.1:9339'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token='1c279d25ed1e4994b32f8d5664508058';
const url='http://127.0.0.1:8123/?mbtiles='+encodeURIComponent('http://127.0.0.1:8140')+'&mbtoken='+token;
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()});
 await sleep(20000);
 const expr=`(async()=>{const out={};try{
  await MaoMaoEarth.ready();
  const buf=await fetch('http://127.0.0.1:8140/tiles/0/0/0.pbf?token='+encodeURIComponent('${token}')).then(r=>r.arrayBuffer());
  out.pbfBytes=buf.byteLength;
  try{const tile=window.MVT.parse(buf);out.layers=tile.layers.map(l=>({name:l.name,extent:l.extent,features:l.features.map(f=>({type:f.type,rings:f.geometry.length,props:Object.keys(f.properties||{})}))}));}catch(e){out.mvtErr=String(e);}
  const layer=LE.listLayers().find(l=>/MBTiles/.test(l.name));
  out.layer=layer?layer.name:null; const il=layer&&layer.imageryLayer; const prov=il&&il.imageryProvider;
  if(prov&&prov.requestImage){const c=await prov.requestImage(0,0,0); const ctx=c.getContext('2d'); const data=ctx.getImageData(0,0,c.width,c.height).data; let nz=0; for(let i=3;i<data.length;i+=4) if(data[i]>0)nz++; out.canvas={w:c.width,h:c.height,nonTransparent:nz,total:data.length/4};}
  // hide all imagery except MBTiles (last)
  const layers=LE.viewer.imageryLayers;
  for(let i=0;i<layers.length;i++){ layers.get(i).show = (i===layers.length-1); }
  out.imageryCount=layers.length;
 }catch(e){out.err=String(e&&(e.stack||e.message)||e);}return JSON.stringify(out);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result);
 console.log('ERRS=',JSON.stringify(errs));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/mbtiles-vector-only.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
