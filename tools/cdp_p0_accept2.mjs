const CDP='http://127.0.0.1:9337'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?windninja=data%2Fsamples%2Fwindninja%2Fterrain_point_10-13-2026_1810_200m_vel.asc&cam=102.4,25.05,12000,-50&exag=1&v='+Date.now()});
 await sleep(22000);
 const expr=`(async()=>{const out={};const wrap=async(k,fn)=>{try{out[k]=await fn();}catch(e){out[k+'Err']=String(e&&(e.stack||e.message)||e);}};
  await wrap('ready',()=>MaoMaoEarth.ready().then(()=>true));
  out.version=MaoMaoEarth.version;
  await wrap('stats',()=>MaoMaoEarth.windninja.getStats());
  await wrap('projKeys',()=>Object.keys(MaoMaoEarth.project.capture()||{}));
  await wrap('png',()=>MaoMaoEarth.export.png({download:false,scale:1}).then(r=>r&&{bytes:r.bytes,width:r.width,height:r.height,whiteRatio:r.whiteRatio,blank:r.blank}));
  await wrap('gj',()=>MaoMaoEarth.export.geojson({download:false}).then(r=>r&&{count:r.count,len:(r.text||'').length}));
  await wrap('kmz',()=>MaoMaoEarth.export.kmz({download:false}).then(r=>r&&{size:r.size}));
  await wrap('cam',()=>MaoMaoEarth.getCamera());
  return out;})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log(JSON.stringify(r.result,null,2).slice(0,4000));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
