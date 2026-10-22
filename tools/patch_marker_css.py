p=r'G:\sh\local-earth\js\markers.js'
c=open(p,encoding='utf-8').read()
c=c.replace("C.toDegrees ? C.toDegrees(carto.latitude) : C.Math.toDegrees(carto.latitude)","C.Math.toDegrees(carto.latitude)").replace("C.toDegrees ? C.toDegrees(carto.longitude) : C.Math.toDegrees(carto.longitude)","C.Math.toDegrees(carto.longitude)")
open(p,'w',encoding='utf-8',newline='').write(c)
css=r'''
/* ---------- 坐标标点 ---------- */
#marker-section .wide { margin-top: 6px; }
.marker-card { width: min(620px, 94vw); }
.marker-tabs { display: flex; gap: 6px; margin: 4px 0 12px; }
.marker-tab { flex: 1; padding: 7px 10px; border: 1px solid rgba(120,170,220,.35); background: rgba(20,36,52,.7); color: #cfe6ff; border-radius: 6px; cursor: pointer; }
.marker-tab.active { background: #2b6fb3; border-color: #5aa8ef; color: #fff; }
.marker-row { display: flex; gap: 10px; align-items: flex-end; }
.marker-row .field { flex: 1; }
.marker-inline { display: flex; gap: 6px; align-items: center; }
.marker-inline input { flex: 1; }
.marker-preview { margin: 10px 0 4px; padding: 8px 10px; border-radius: 6px; background: rgba(20,36,52,.65); color: #d7ecff; font: 12px/1.7 Consolas, monospace; white-space: normal; }
.marker-check { display: flex; align-items: center; gap: 6px; margin: 6px 0; color: #cfe6ff; font-size: 13px; }
.marker-actions { flex-wrap: wrap; }
.marker-list-card { width: min(860px, 96vw); }
.marker-list-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
.marker-list-toolbar input { flex: 1; }
.marker-list-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.marker-table-wrap { max-height: 52vh; overflow: auto; border: 1px solid rgba(120,170,220,.25); border-radius: 6px; }
.marker-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.marker-table th, .marker-table td { padding: 7px 8px; border-bottom: 1px solid rgba(120,170,220,.16); text-align: left; vertical-align: top; }
.marker-table th { position: sticky; top: 0; background: #172b3d; color: #d8ecff; z-index: 1; }
.marker-table .marker-coord { font-family: Consolas, monospace; color: #bfe3ff; white-space: nowrap; }
.marker-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; box-shadow: 0 0 0 1px rgba(255,255,255,.7); }
.marker-note { color: #9db8cc; font-size: 11px; margin-top: 2px; }
.marker-row-actions { white-space: nowrap; }
.marker-row-actions .btn { padding: 3px 6px; margin: 0 2px; font-size: 11px; }
.marker-row-actions .danger { color: #ff9c9c; }
.marker-empty { color: #9db8cc; text-align: center; padding: 18px; }
.marker-batch-card { width: min(620px, 94vw); }
.marker-batch-card textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: Consolas, monospace; }
'''
p2=r'G:\sh\local-earth\css\app.css'
a=open(p2,encoding='utf-8').read()
if '/* ---------- 坐标标点 ---------- */' not in a:
 a=a.rstrip('\n')+'\n'+css
 open(p2,'w',encoding='utf-8',newline='').write(a)
print('css/markers patched')
