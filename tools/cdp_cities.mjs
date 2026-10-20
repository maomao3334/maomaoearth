import fs from 'node:fs';
const CDP='http://127.0.0.1:9336'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?cam=91,31,5000000,-60&v='+Date.now()});
 await sleep(16000);
 await send('Runtime.evaluate',{expression:"document.querySelector('#btn-pub-places').click()",returnByValue:true});
 await sleep(7000);
 let shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/cities-far.png',Buffer.from(shot.result.data,'base64'));
 await send('Runtime.evaluate',{expression:"(()=>{const C=LE.Cesium;LE.viewer.camera.setView({destination:C.Cartesian3.fromDegrees(91,31,400000),orientation:{heading:0,pitch:C.Math.toRadians(-70),roll:0}});return true;})()",returnByValue:true});
 await sleep(7000);
 shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/cities-near.png',Buffer.from(shot.result.data,'base64'));
 const r=await send('Runtime.evaluate',{expression:`(()=>{const dsc=LE.viewer.dataSources;let ds=null;for(let i=0;i<dsc.length;i++){if(/populated_places/.test(dsc.get(i).name))ds=dsc.get(i);}if(!ds)return {err:'no ds'};let bill=0,cond=0,dist=null;for(const e of ds.entities.values){if(e.billboard){bill++;try{const d=e.billboard.distanceDisplayCondition;if(d){cond++;dist=d.getValue?d.getValue(LE.Cesium.JulianDate.now()):d;}}catch(x){}}}return {bill,cond,dist,height:LE.viewer.camera.positionCartographic.height};})()`,returnByValue:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
