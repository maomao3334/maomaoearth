const CDP='http://127.0.0.1:9334'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?cam=91,31,9000,-60'});
 await sleep(10000);
 const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined;};
 await ev("document.querySelector('#btn-pub-admin0').click()"); await sleep(10000);
 const res=await ev(`(()=>{const C=LE.Cesium,now=C.JulianDate.now();const dsc=LE.viewer.dataSources;const out=[];
 for(let i=0;i<dsc.length;i++){const ds=dsc.get(i);const ents=ds.entities&&ds.entities.values?ds.entities.values:[];let poly=0,pl=0;const ptypes={},ltypes={};let hasArc=false,sample=null;
  for(const e of ents){if(e.polygon){poly++;hasArc=('arcType' in e.polygon);let a='na';try{a=e.polygon.arcType&&e.polygon.arcType.getValue?e.polygon.arcType.getValue(now):e.polygon.arcType;}catch(x){a='err';}ptypes[a]=(ptypes[a]||0)+1;if(!sample){let h=null;try{h=e.polygon.hierarchy&&e.polygon.hierarchy.getValue?e.polygon.hierarchy.getValue(now):null;}catch(x){} sample={name:e.name&&e.name.getValue?e.name.getValue(now):'',hasHierarchy:!!h,posLen:h&&h.positions?h.positions.length:0};}}
   if(e.polyline){pl++;let a='na';try{a=e.polyline.arcType&&e.polyline.arcType.getValue?e.polyline.arcType.getValue(now):e.polyline.arcType;}catch(x){a='err';}ltypes[a]=(ltypes[a]||0)+1;}}
  if(poly||pl)out.push({name:ds.name,polygons:poly,ptypes,polylines:pl,ltypes,hasArc,sample});}
 return out;})()`);
 console.log(JSON.stringify(res,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
