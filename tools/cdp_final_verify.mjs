import fs from 'node:fs';
const CDP='http://127.0.0.1:9335'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__cons=[];(function(){var oe=console.error;console.error=function(){try{window.__cons.push(Array.prototype.map.call(arguments,function(a){return a&&(a.stack||a.message)?(a.stack||a.message):String(a)}).join(' | '))}catch(x){};return oe.apply(console,arguments)}})();`});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=91,31,12000,-55&exag=2.3'});
 await sleep(16000);
 const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result&&r.result.result?r.result.result.value:undefined;};
 for(const sel of ['#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places','#btn-pub-admin0']){await ev("document.querySelector('"+sel+"').click()");await sleep(4500);}
 for(let k=0;k<10;k++){
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:760,y:430,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:760-240*i/8,y:430-60*i/8,button:'left',buttons:1});await sleep(25);}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:520,y:370,button:'left',clickCount:1});
  await sleep(250);
 }
 for(let i=0;i<4;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:400,deltaX:0,deltaY:-500});await sleep(300);}
 await sleep(8000);
 const res=await ev("({panel:!!document.querySelector('.cesium-widget-errorPanel'), text:(document.querySelector('.cesium-widget-errorPanel')||{}).innerText||'', cons:window.__cons||[]})");
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/crash-fix-final.png',Buffer.from(shot.result.data,'base64'));
 console.log(JSON.stringify(res,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
