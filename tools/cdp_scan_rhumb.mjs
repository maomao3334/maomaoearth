const CDP='http://127.0.0.1:9333'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3'});
 await sleep(16000);
 for(const sel of ['#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places','#btn-pub-admin0']){
   await send('Runtime.evaluate',{expression:"document.querySelector('"+sel+"').click()",returnByValue:true}); await sleep(5000);
 }
 await sleep(6000);
 const expr=`(()=>{const C=LE.Cesium,now=C.JulianDate.now(),out=[];const dsc=LE.viewer.dataSources;
 for(let i=0;i<dsc.length;i++){const ds=dsc.get(i);const ents=ds.entities&&ds.entities.values?ds.entities.values:[];const types={};const rhumb=[];let undef=0;
  for(const e of ents){if(!e.polyline)continue;let a=null;try{a=e.polyline.arcType&&e.polyline.arcType.getValue?e.polyline.arcType.getValue(now):e.polyline.arcType;}catch(x){}
   if(a===undefined||a===null){undef++;continue;} types[a]=(types[a]||0)+1;
   if(a===2&&rhumb.length<5){let nm='';try{nm=e.name&&e.name.getValue?e.name.getValue(now):e.name;}catch(x){} let pl=0;try{const p=e.polyline.positions&&e.polyline.positions.getValue?e.polyline.positions.getValue(now):e.polyline.positions;pl=p&&p.length||0;}catch(x){} rhumb.push({name:nm,posLen:pl});}
  }
  out.push({name:ds.name,polylines:Object.values(types).reduce((a,b)=>a+b,0),types,undef,rhumb:rhumb.slice(0,3)});
 }
 return out;})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
