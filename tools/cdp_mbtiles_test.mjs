import fs from 'node:fs';
const CDP='http://127.0.0.1:9338'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token='b794a68e390d4120a280ebdaf2f5eb32';
const url='http://127.0.0.1:8128/?mbtiles='+encodeURIComponent('http://127.0.0.1:8140')+'&mbtoken='+token;
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()});
 await sleep(20000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();s.api=!!MaoMaoEarth.mbtiles;s.state=window.LEMBTiles.getState();s.imagery=LE.viewer.imageryLayers.length;s.layers=LE.listLayers().filter(l=>/MBTiles/.test(l.name)).map(l=>l.name);s.meta=await fetch('http://127.0.0.1:8140/meta.json?token=`+token+`').then(r=>r.json());}catch(e){s.err=String(e&&(e.stack||e.message)||e);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result);
 console.log('ERRS=',JSON.stringify(errs));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/mbtiles-app-v040.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
