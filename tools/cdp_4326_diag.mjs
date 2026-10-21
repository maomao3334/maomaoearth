import fs from 'node:fs';
const CDP='http://127.0.0.1:9339'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token='298513b1b65742b5b9667be709d40fba';
const url='http://127.0.0.1:8123/?mbtiles='+encodeURIComponent('http://127.0.0.1:8140')+'&mbtoken='+token;
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const reqs=[]; const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text); if(m.method==='Network.requestWillBeSent'&&m.params.request.url.indexOf('8140')>=0)reqs.push(m.params.request.url);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()});
 await sleep(20000);
 const expr=`(async()=>{const out={};try{
  await MaoMaoEarth.ready();
  const layers=LE.viewer.imageryLayers;
  out.count=layers.length;
  out.list=[]; for(let i=0;i<layers.length;i++){const l=layers.get(i);out.list.push({i,show:l.show,alpha:l.alpha,ready:l.ready,provider:l.imageryProvider&&(l.imageryProvider.constructor&&l.imageryProvider.constructor.name)||''});}
  const m=LE.listLayers().find(l=>/MBTiles/.test(l.name)); out.mb=m?m.name:null; out.mbIndex=m&&m.imageryLayer?layers.indexOf(m.imageryLayer):-1;
  if(m&&m.imageryLayer){const p=m.imageryLayer.imageryProvider; try{const img=await p.requestImage(0,0,0); out.tile={w:img.width,h:img.height,src:(img.src||'').slice(0,80)};}catch(e){out.tileErr=String(e);} }
  // raise to top and report
  layers.raiseToTop(m.imageryLayer);
  await new Promise(r=>setTimeout(r,800));
  out.mbIndex2=layers.indexOf(m.imageryLayer);
  out.topProvider=layers.get(layers.length-1).imageryProvider && layers.get(layers.length-1).imageryProvider.constructor;
  out.raised=true;
 }catch(e){out.err=String(e&&(e.stack||e.message)||e);}return JSON.stringify(out);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result);
 console.log('REQS=',JSON.stringify(reqs.slice(0,10)));
 console.log('ERRS=',JSON.stringify(errs));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/mbtiles-4326-raised.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
