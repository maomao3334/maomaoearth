const CDP='http://127.0.0.1:9335'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?cam=91,31,8000,-60&exag=1&v='+Date.now()});
 await sleep(14000);
 await send('Runtime.evaluate',{expression:"document.querySelector('#btn-pub-admin0').click()",returnByValue:true});
 await sleep(12000);
 const expr=`(()=>{const dsc=LE.viewer.dataSources;let ds=null;for(let i=0;i<dsc.length;i++){if(/admin_0/.test(dsc.get(i).name))ds=dsc.get(i);}if(!ds)return {err:'no ds'};const C=LE.Cesium,now=C.JulianDate.now();let lines=0;let sample=null;for(const e of ds.entities.values){if(!e.polyline)continue;lines++;if(!sample){const pos=e.polyline.positions.getValue?e.polyline.positions.getValue(now):e.polyline.positions;if(pos&&pos.length){let min=1e9,max=-1e9;for(const p of pos){const c=C.Cartographic.fromCartesian(p);const h=c?c.height:0;if(h<min)min=h;if(h>max)max=h;}sample={len:pos.length,minH:min,maxH:max,clamp:e.polyline.clampToGround&&e.polyline.clampToGround.getValue?e.polyline.clampToGround.getValue(now):e.polyline.clampToGround};}}}return {lines,sample};})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
