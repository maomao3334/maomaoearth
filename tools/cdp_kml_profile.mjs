import fs from 'node:fs';
const CDP='http://127.0.0.1:9340'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const url=process.argv[2]; const out=process.argv[3]||'kml-profile';
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json(); const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const logs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.consoleAPICalled'){logs.push(m.params.type+': '+m.params.args.map(a=>a.value||a.description||'').join(' ').slice(0,300));} if(m.method==='Runtime.exceptionThrown')logs.push('EXC: '+m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true})); await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()}); await sleep(90000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();s.ready=true;const K=window.LEKml;s.stats=K&&K.getPerfStats?K.getPerfStats():null;s.layers=LE.listLayers().map(l=>({name:l.name,type:l.type}));s.dataSources=LE.viewer.dataSources.length;let ent=0;for(let i=0;i<LE.viewer.dataSources.length;i++)ent+=LE.viewer.dataSources.get(i).entities.values.length;s.entities=ent;s.primitives=LE.viewer.scene.primitives.length;s.timeline=!!document.querySelector('#kml-timeline');const frames=await new Promise(res=>{let n=0;const t0=performance.now();function tick(){n++;const dt=performance.now()-t0;if(dt<1500)requestAnimationFrame(tick);else res({frames:n,ms:dt,fps:n/(dt/1000)});}requestAnimationFrame(tick);});s.fps=frames;}catch(e){s.err=String(e&&(e.stack||e.message)||e);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result); console.log('LOGS=',JSON.stringify(logs.slice(-25))); console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 const shot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('G:/sh/local-earth/docs/testdata/'+out+'.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
