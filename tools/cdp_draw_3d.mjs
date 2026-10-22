import fs from 'node:fs';
const CDP='http://127.0.0.1:9343'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[]; const logs=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text); if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description||'').join(' '));});
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8123/?v='+Date.now()});
  await sleep(15000);
  const expr=`(async()=>{const out={};try{
    await MaoMaoEarth.ready();
    out.terrainWasEnabled = LETerrain.isEnabled();
    if(!LETerrain.isEnabled()) await LETerrain.toggle(LE);
    await new Promise(r=>setTimeout(r,3500));
    out.terrainEnabled = LETerrain.isEnabled();
    out.terrainState = LETerrain.getState ? LETerrain.getState() : null;
    LEDraw.clearAll ? LEDraw.clearAll() : null;
    LEDraw.loadGeoJSON(JSON.stringify({type:'FeatureCollection',features:[
      {type:'Feature',properties:{name:'地形测试线'},geometry:{type:'LineString',coordinates:[[102.45,25.05],[102.50,25.10],[102.55,25.06]]}},
      {type:'Feature',properties:{name:'地形测试面'},geometry:{type:'Polygon',coordinates:[[[102.47,25.02],[102.52,25.02],[102.52,25.07],[102.47,25.07],[102.47,25.02]]]}}
    ]}));
    await new Promise(r=>setTimeout(r,1200));
    const C=LE.Cesium;
    LE.viewer.camera.setView({destination:C.Cartesian3.fromDegrees(102.50,25.06,4200),orientation:{heading:0,pitch:-0.55,roll:0}});
    await new Promise(r=>setTimeout(r,2500));
    out.camera={height:Math.round(LE.viewer.camera.positionCartographic.height),pitch:+LE.viewer.camera.pitch.toFixed(2)};
    let labels=0,points=0,lines=0,polys=0,labelsNoDepth=0,lineClamp=0;
    for(const e of LE.viewer.entities.values){
      if(e.label){labels++; if(e.label.disableDepthTestDistance && e.label.disableDepthTestDistance.getValue && e.label.disableDepthTestDistance.getValue()===Number.POSITIVE_INFINITY)labelsNoDepth++;}
      if(e.point)points++;
      if(e.polyline){lines++; try{if(e.polyline.clampToGround && e.polyline.clampToGround.getValue())lineClamp++;}catch(x){}}
      if(e.polygon)polys++;
    }
    out.entities={labels,points,lines,polys,total:LE.viewer.entities.values.length,labelsNoDepth,lineClamp};
    out.list=LEDraw.list();
    out.style=LEDraw.getStyle();
    return JSON.stringify(out);
  }catch(e){out.err=String(e&&(e.stack||e.message)||e);return JSON.stringify(out);}})()`;
  const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  console.log('VAL',r.result&&r.result.result?r.result.result.value:JSON.stringify(r.result));
  console.log('EXC',JSON.stringify(r.result&&r.result.exceptionDetails||null));
  console.log('ERRS',JSON.stringify(errs)); console.log('LOGS',JSON.stringify(logs));
  await sleep(600);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('G:/sh/local-earth/docs/testdata/draw-3d-terrain.png',Buffer.from(shot.result.data,'base64'));
  ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
