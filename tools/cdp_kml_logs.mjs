import fs from 'node:fs';
const CDP='http://127.0.0.1:9340'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const url='http://127.0.0.1:8123/?demo='+encodeURIComponent('data/samples/perf/wind_animation.kml')+'&kmlperf=1&perf=high&v='+Date.now();
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json(); const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const logs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.consoleAPICalled'){const s=m.params.type+': '+m.params.args.map(a=>a.value||a.description||'').join(' '); if(/LEKml|error|fail|warn|Exception|line|Polyline/i.test(s)) logs.push(s.slice(0,1000));}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true})); await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate',{url}); await sleep(25000);
 console.log('LOGS',JSON.stringify(logs.slice(-30),null,1));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
