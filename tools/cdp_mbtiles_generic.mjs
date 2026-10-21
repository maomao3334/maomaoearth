import fs from 'node:fs';
const CDP='http://127.0.0.1:9339'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const appPort=process.argv[2]||'8131';
const state=Object.fromEntries(fs.readFileSync('G:/sh/local-earth/.maomaoearth-mbtiles.state','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const url='http://127.0.0.1:'+appPort+'/?mbtiles='+encodeURIComponent('http://127.0.0.1:'+state.port)+'&mbtoken='+encodeURIComponent(state.token);
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()});
 await sleep(18000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();s.state=window.LEMBTiles.getState();s.mvt=!!window.LEMvt;if(window.LEMvt)s.mvtVersion=window.LEMvt.version;s.imagery=LE.viewer.imageryLayers.length;const layers=LE.listLayers().filter(l=>/MBTiles/.test(l.name));s.layers=layers.map(l=>l.name);let prov=null;for(let i=0;i<LE.viewer.imageryLayers.length;i++){const l=LE.viewer.imageryLayers.get(i);if(l.imageryProvider&&l.imageryProvider.tilingScheme){prov=l.imageryProvider;}}if(!prov&&layers[0]&&layers[0].imageryLayer)prov=layers[0].imageryLayer.imageryProvider;if(prov){s.tiling=prov.tilingScheme&&prov.tilingScheme.constructor?prov.tilingScheme.constructor.name:null;s.min=prov.minimumLevel;s.max=prov.maximumLevel;const mz=(s.state&&s.state.minzoom)||0;try{const canvas=await prov.requestImage(0,0,mz);s.canvas={w:canvas.width,h:canvas.height};try{const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;s.canvas.nonTransparent=n;}catch(e){s.canvas.err=String(e);}}catch(e){s.canvasErr=String(e);}}}catch(e){s.err=String(e&&(e.stack||e.message)||e);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result);
 console.log('ERRS=',JSON.stringify(errs));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/mbtiles-vector-3857.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
