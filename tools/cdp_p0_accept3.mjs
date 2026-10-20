const CDP='http://127.0.0.1:9337'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?windninja=data%2Fsamples%2Fwindninja%2Fterrain_point_10-13-2026_1810_200m_vel.asc&v='+Date.now()});
 await sleep(22000);
 const expr=`(async()=>{const out={};const wrap=async(k,fn)=>{try{out[k]=await fn();}catch(e){out[k+'Err']=String(e&&(e.stack||e.message)||e);}};
  await wrap('ready',()=>MaoMaoEarth.ready().then(()=>true));
  await wrap('gj',()=>MaoMaoEarth.export.geojson({download:false}).then?MaoMaoEarth.export.geojson({download:false}):MaoMaoEarth.export.geojson({download:false}));
  await wrap('exagSet',()=>MaoMaoEarth.terrain.setExaggeration(1.4));
  await wrap('exagGet',()=>MaoMaoEarth.terrain.getExaggeration());
  await wrap('perf',()=>{MaoMaoEarth.perf.setMode('medium');return {mode:MaoMaoEarth.perf.getMode(),effective:MaoMaoEarth.perf.getEffective()};});
  await wrap('projSave',()=>{const r=window.LEProject.save({download:false});return r&&{filename:r.filename,bytes:r.bytes};});
  return out;})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2).slice(0,3000));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
