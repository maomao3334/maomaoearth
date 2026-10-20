const CDP='http://127.0.0.1:9333'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const list=await (await fetch(CDP+'/json/list')).json(); const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[]; const logs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
   if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails; errs.push({text:d.text,desc:d.exception&&d.exception.description,stack:d.stackTrace});}
   if(m.method==='Log.entryAdded'){const e=m.params.entry; if(e.level==='error'||e.level==='warning') logs.push({level:e.level,text:e.text});}
 });
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3'});
 await sleep(16000);
 for(const sel of ['#btn-pub-admin0','#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places']){
   await send('Runtime.evaluate',{expression:"document.querySelector('"+sel+"').click()",returnByValue:true});
   await sleep(3500);
 }
 const drag=async(x0,y0,x1,y1)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x0,y:y0,button:'left',clickCount:1});for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0+(x1-x0)*i/8,y:y0+(y1-y0)*i/8,button:'left',buttons:1});await sleep(25);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x1,y:y1,button:'left',clickCount:1});await sleep(300);};
 for(let i=0;i<8;i++){await drag(760,430,540,380);}
 for(let i=0;i<4;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:400,deltaX:0,deltaY:-500});await sleep(400);}
 await sleep(6000);
 const expr=`(()=>{const C=LE.Cesium;const out=[];const now=C.JulianDate.now();const dsc=LE.viewer.dataSources;for(let i=0;i<dsc.length;i++){const ds=dsc.get(i);const ents=ds.entities&&ds.entities.values?ds.entities.values:[];let pl=0;const types={};for(const e of ents){if(!e.polyline)continue;pl++;let a='na';try{a=e.polyline.arcType&&e.polyline.arcType.getValue?String(e.polyline.arcType.getValue(now)):String(e.polyline.arcType);}catch(x){a='err';}types[a]=(types[a]||0)+1;}out.push({name:ds.name,polylines:pl,types});}return out;})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
 console.log(JSON.stringify({errors:errs,logs,arctype:r.result&&r.result.result?r.result.result.value:null},null,2));
 ws.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
