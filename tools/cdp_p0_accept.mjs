import fs from 'node:fs';
const CDP='http://127.0.0.1:9337'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?windninja=data%2Fsamples%2Fwindninja%2Fterrain_point_10-13-2026_1810_200m_vel.asc&cam=102.4,25.05,12000,-50&exag=1&v='+Date.now()});
 await sleep(22000);
 const expr=`(async()=>{
   await MaoMaoEarth.ready();
   const stats = MaoMaoEarth.windninja.getStats();
   const proj = MaoMaoEarth.project.capture();
   const png = await MaoMaoEarth.export.png({download:false,scale:1});
   const gj = MaoMaoEarth.export.geojson({download:false});
   const kmz = await MaoMaoEarth.export.kmz({download:false});
   const cam = MaoMaoEarth.getCamera();
   return {version:MaoMaoEarth.version, stats: stats ? {arrows:stats.arrows, speedMin:stats.speedMin, speedMax:stats.speedMax, grid:stats.grid, bounds:stats.bounds} : null,
     projectKeys: proj ? Object.keys(proj) : null,
     png: png ? {bytes:png.bytes,width:png.width,height:png.height,whiteRatio:png.whiteRatio,blank:png.blank} : null,
     gj: gj ? {count:gj.count, bytes:(gj.text||'').length} : null,
     kmz: kmz ? {size:kmz.size} : null, cam, layers:MaoMaoEarth.listLayers().map(l=>l.name)};
 })()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 const val=r.result&&r.result.result?r.result.result.value:r.result;
 console.log(JSON.stringify({errs,val},null,2));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/p0-acceptance-api.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
