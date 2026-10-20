const CDP='http://127.0.0.1:9337'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const t=await (await fetch(CDP+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
 ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id).resolve(m);pend.delete(m.id);} if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,{resolve:res});ws.send(JSON.stringify({id:mid,method,params}));});
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.navigate',{url:'http://127.0.0.1:8123/?windninja=data%2Fsamples%2Fwindninja%2Fterrain_point_10-13-2026_1810_200m_vel.asc&cam=102.4,25.05,9000,-50&exag=1.3&lighting=1&sun=9.5&v='+Date.now()});
 await sleep(24000);
 const expr=`(async()=>{const s={};try{await MaoMaoEarth.ready();
 s.api=typeof MaoMaoEarth+':'+MaoMaoEarth.version;
 s.mods=[!!window.LELighting,!!window.LELayerPanel,!!window.LEDiagnostics,!!window.LEDraw,!!window.LEProfile].join(',');
 const st=window.LELighting.getState(); s.light={enabled:st.enabled,hours:st.hours,utc:st.utc,globe:st.globe&&st.globe.enableLighting};
 window.LELighting.setTime(15); const st2=window.LELighting.getState(); s.light2={hours:st2.hours,utc:st2.utc};
 const gs=window.LELayerPanel.getGroups(); s.groups=gs.map(g=>({g:g.group||g.label||g.name,n:(g.items||g.layers||[]).length}));
 const rep=window.LEDiagnostics.getReport(); s.diag={gpu:(rep.gpu&&(rep.gpu.renderer||rep.gpu.webglRenderer))||null,fps:(rep.fps&&rep.fps.fps)||null,keys:Object.keys(rep).slice(0,12)};
 const gj=window.LEDraw.getGeoJSON(); s.draw={type:gj.type,n:(gj.features||[]).length};
 s.profileCandidates=(window.LEProfile.getCandidates()||[]).length;
 s.apiP1=[!!MaoMaoEarth.lighting,!!MaoMaoEarth.layersPanel,!!MaoMaoEarth.diagnostics,!!MaoMaoEarth.draw,!!MaoMaoEarth.profile].join(',');
 }catch(e){s.err=String(e&&(e.stack||e.message)||e);} return JSON.stringify(s);})()`;
 const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
 const ro=r.result&&r.result.result;
 console.log('EXC=',JSON.stringify(r.result&&r.result.exceptionDetails||null));
 console.log('VAL=',ro&&ro.value);
 console.log('ERRS=',JSON.stringify(errs));
 ws.close(); await fetch(CDP+'/json/close/'+t.id);
}
main().catch(e=>{console.error(e);process.exit(1);});
