import fs from 'node:fs';
const CDP='http://127.0.0.1:9339'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=Object.fromEntries(fs.readFileSync('G:/sh/local-earth/.maomaoearth-mbtiles.state','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const url='http://127.0.0.1:8131/?mbtiles='+encodeURIComponent('http://127.0.0.1:'+state.port)+'&mbtoken='+encodeURIComponent(state.token);
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()}); await sleep(18000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();const ls=LE.listLayers();const e=ls.find(l=>/MBTiles/.test(l.name));s.layer=e?{name:e.name,type:e.type,hasImageryLayer:!!e.imageryLayer}:null;let prov=e&&e.imageryLayer?e.imageryLayer.imageryProvider:null;if(!prov){for(let i=0;i<LE.viewer.imageryLayers.length;i++){const l=LE.viewer.imageryLayers.get(i);if(l.imageryProvider&&/MBTiles/.test(e?e.name:'')){}}}if(prov){s.provider={tiling:prov.tilingScheme&&prov.tilingScheme.constructor?prov.tilingScheme.constructor.name:null,min:prov.minimumLevel,max:prov.maximumLevel,tw:prov.tileWidth,tile:prov.tileHeight};const c=await prov.requestImage(0,0,0);s.canvas={w:c.width,h:c.height};const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;s.canvas.nonTransparent=n;}if(e&&e.imageryLayer){for(let i=0;i<LE.viewer.imageryLayers.length;i++){const l=LE.viewer.imageryLayers.get(i);if(l!==e.imageryLayer)l.show=false;}LE.viewer.camera.flyTo({destination:LE.Cesium.Cartesian3.fromDegrees(0,0,12000000),duration:0});} }catch(err){s.err=String(err&&(err.stack||err.message)||err);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 console.log('VAL=',r.result&&r.result.result?r.result.result.value:r.result);
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('G:/sh/local-earth/docs/testdata/mbtiles-vector-only.png',Buffer.from(shot.result.data,'base64'));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
