import fs from 'node:fs';
const CDP='http://127.0.0.1:9333'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const list=await (await fetch(CDP+'/json/list')).json(); const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[]; const logs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
   if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}
   if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;errs.push(d.text);}
   if(m.method==='Log.entryAdded'){const e=m.params.entry;if(e.level==='error')logs.push(e.text);}
 });
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3'});
 await sleep(16000);
 for(const sel of ['#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places','#btn-pub-admin0']){
   await send('Runtime.evaluate',{expression:"document.querySelector('"+sel+"').click()",returnByValue:true});
   await sleep(3000);
 }
 for(let k=0;k<4;k++){
   await send('Input.dispatchMouseEvent',{type:'mousePressed',x:760,y:430,button:'left',clickCount:1});
   for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:760-220*i/8,y:430-50*i/8,button:'left',buttons:1});await sleep(25);}
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:540,y:380,button:'left',clickCount:1});
   await sleep(400);
 }
 await sleep(5000);
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:\\sh\\local-earth\\docs\\testdata\\crash-fix-verify.png', Buffer.from(shot.result.data,'base64'));
 console.log(JSON.stringify({errors:errs,logs},null,2));
 ws.close();
}
main().catch(e=>{console.error(e);process.exit(1);});

