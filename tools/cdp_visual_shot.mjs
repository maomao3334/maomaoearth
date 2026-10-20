import fs from 'node:fs';
const CDP='http://127.0.0.1:9335'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=91,31,12000,-55&exag=2.3'});
 await sleep(18000);
 for(const sel of ['#btn-pub-admin0','#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places']){
   await send('Runtime.evaluate',{expression:"document.querySelector('"+sel+"').click()",returnByValue:true}); await sleep(6000);
 }
 await sleep(5000);
 const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result&&r.result.result?r.result.result.value:undefined;};
 console.log('panel=',await ev("!!document.querySelector('.cesium-widget-errorPanel')"));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/vector-drape-tibet.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
