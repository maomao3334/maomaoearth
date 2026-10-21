import fs from 'node:fs';
const CDP='http://127.0.0.1:9340'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const url='http://127.0.0.1:8123/?demo='+encodeURIComponent('data/samples/perf/wind_animation.kml')+'&kmlperf=1&perf=high&v='+Date.now();
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json(); const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true})); await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate',{url}); await sleep(30000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();const ls=LE.listLayers();const l=ls.find(x=>/wind_animation/.test(x.name));s.layer=l?{name:l.name,meta:l.meta}:null;s.stats=LEKml.getPerfStats();s.dataSources=LE.viewer.dataSources.length;s.entities=LE.viewer.dataSources.get(LE.viewer.dataSources.length-1).entities.values.length;s.prims=LE.viewer.scene.primitives.length;}catch(e){s.err=String(e);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); console.log(r.result&&r.result.result?r.result.result.value:r.result);
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
