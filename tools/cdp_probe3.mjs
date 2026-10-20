const CDP='http://127.0.0.1:9333'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const list=await (await fetch(CDP+'/json/list')).json(); const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?cam=102.4,25,9000,-60'});
 await sleep(8000);
 for(const sel of ['#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places','#btn-pub-admin0']){
   await send('Runtime.evaluate',{expression:"document.querySelector('"+sel+"').click()",returnByValue:true});
   await sleep(5000);
 }
 const expr=`(()=>{const C=LE.Cesium;const out=[];const now=C.JulianDate.now();const dsc=LE.viewer.dataSources;for(let i=0;i<dsc.length;i++){const ds=dsc.get(i);const ents=ds.entities&&ds.entities.values?ds.entities.values:[];let pl=0;const types={};let bad=0;let sampleBad=null;for(const e of ents){if(!e.polyline)continue;pl++;let a='na';try{a=e.polyline.arcType&&e.polyline.arcType.getValue?String(e.polyline.arcType.getValue(now)):String(e.polyline.arcType);}catch(x){a='err';}types[a]=(types[a]||0)+1;try{const pos=e.polyline.positions&&e.polyline.positions.getValue?e.polyline.positions.getValue(now):e.polyline.positions;if(!Array.isArray(pos)||pos.length<2){bad++;sampleBad=sampleBad||{reason:'len',n:pos&&pos.length};}else{for(const p of pos){const c=C.Cartographic.fromCartesian(p);if(!c||!isFinite(c.longitude)||!isFinite(c.latitude)||Math.abs(c.latitude)>Math.PI/2){bad++;sampleBad=sampleBad||{reason:'coord',lon:c&&c.longitude,lat:c&&c.latitude,len:pos.length};break;}}}}catch(x){bad++;sampleBad=sampleBad||{reason:'err',msg:String(x)};}}out.push({name:ds.name,ents:ents.length,polylines:pl,types,bad,sampleBad});}return out;})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2));
 ws.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
