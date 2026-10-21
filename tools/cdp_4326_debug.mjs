import fs from 'node:fs';
const CDP='http://127.0.0.1:9339'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=Object.fromEntries(fs.readFileSync('G:/sh/local-earth/.maomaoearth-mbtiles.state','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const url='http://127.0.0.1:8132/?mbtiles='+encodeURIComponent('http://127.0.0.1:'+state.port)+'&mbtoken='+encodeURIComponent(state.token);
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json(); const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);}});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true})); await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:url+'&v='+Date.now()}); await sleep(18000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();const e=LE.listLayers().find(l=>/MBTiles/.test(l.name));s.entry=!!e;const l=e.imageryLayer;s.layer={show:l.show,alpha:l.alpha,provider:!!l.imageryProvider};const p=l.imageryProvider;s.prov={tiling:Object.prototype.toString.call(p.tilingScheme),geo:p.tilingScheme instanceof LE.Cesium.GeographicTilingScheme,web:p.tilingScheme instanceof LE.Cesium.WebMercatorTilingScheme,rect:p.rectangle?[LE.Cesium.Math.toDegrees(p.rectangle.west),LE.Cesium.Math.toDegrees(p.rectangle.south),LE.Cesium.Math.toDegrees(p.rectangle.east),LE.Cesium.Math.toDegrees(p.rectangle.north)]:null,min:p.minimumLevel,max:p.maximumLevel};const img=await p.requestImage(0,0,0);s.img={w:img.width,h:img.height,src:String(img.src||'').slice(0,120)};const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,256,256).data;let blue=0,opaque=0;for(let i=0;i<d.length;i+=4){if(d[i+3]>0)opaque++;if(d[i]<80&&d[i+1]<140&&d[i+2]>100)blue++;}s.pixels={opaque:opaque,blue:blue};for(let i=0;i<LE.viewer.imageryLayers.length;i++){const x=LE.viewer.imageryLayers.get(i);if(x!==l)x.show=false;}s.visible=[...Array(LE.viewer.imageryLayers.length)].map((_,i)=>LE.viewer.imageryLayers.get(i).show);}catch(err){s.err=String(err&&(err.stack||err.message)||err);}return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); console.log(r.result&&r.result.result?r.result.result.value:r.result);
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
