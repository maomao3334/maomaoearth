const CDP='http://127.0.0.1:9333'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__cons=[];(function(){var oe=console.error;console.error=function(){try{window.__cons.push(Array.prototype.map.call(arguments,function(a){return a&&(a.stack||a.message)?(a.stack||a.message):String(a)}).join(' | '))}catch(x){};return oe.apply(console,arguments)}})();`});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?demo=data%2Fsamples%2Fwind%2Fwind3d_test.kmz&cam=102.40,25.02,9000,-60&exag=2.3'});
 await sleep(16000);
 const evalv=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});return r.result&&r.result.result?r.result.result.value:undefined;};
 console.log('after boot panel=',await evalv("!!document.querySelector('.cesium-widget-errorPanel')"));
 for(const sel of ['#btn-pub-rivers','#btn-pub-lakes','#btn-pub-places','#btn-pub-admin0']){
   await evalv("document.querySelector('"+sel+"').click()"); await sleep(7000);
   console.log(sel,'panel=',await evalv("!!document.querySelector('.cesium-widget-errorPanel')"),'text=',await evalv("(document.querySelector('.cesium-widget-errorPanel')||{}).innerText||''"));
 }
 const cons=await evalv("window.__cons"); console.log('CONSOLE ERRORS:\n'+(cons||[]).join('\n---\n'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
