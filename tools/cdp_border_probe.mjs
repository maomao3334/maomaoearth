const CDP='http://127.0.0.1:9335'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
 await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?cam=91,31,8000,-60&exag=1&v='+Date.now()});
 await sleep(14000);
 await send('Runtime.evaluate',{expression:"document.querySelector('#btn-pub-admin0').click()",returnByValue:true});
 await sleep(10000);
 const r=await send('Runtime.evaluate',{expression:`(()=>{const dsc=LE.viewer.dataSources;const out=[];for(let i=0;i<dsc.length;i++){const ds=dsc.get(i);const ents=ds.entities.values;let poly=0,line=0;for(const e of ents){if(e.polygon)poly++;if(e.polyline)line++;}out.push({name:ds.name,entities:ents.length,polygons:poly,polylines:line});}return out;})()`,returnByValue:true});
 console.log(JSON.stringify(r.result&&r.result.result?r.result.result.value:r.result,null,2));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
