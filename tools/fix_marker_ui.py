p=r'G:\sh\local-earth\js\markers.js'
c=open(p,encoding='utf-8').read()
c=c.replace('    list: listRecords,','    list: getProjectState,',1)
c=c.replace('  function openList() {\n    const dlg = ensureListDialog();\n    dlg.classList.remove(\'hidden\');\n    renderList();\n  }','  function openList() {\n    const dlg = ensureListDialog();\n    dlg.classList.remove(\'hidden\');\n    updateCount();\n    renderList();\n  }',1)
c=c.replace('  function renderList() {\n    const dlg = state.listDialog;\n    if (!dlg) return;','  function renderList() {\n    const dlg = state.listDialog;\n    if (!dlg) return;\n    updateCount();',1)
open(p,'w',encoding='utf-8',newline='').write(c)
css=r'''
/* 坐标标点：表单纵向布局修正 */
.marker-card .field { display: block; margin-bottom: 8px; }
.marker-card .field > label { display: block; margin-bottom: 3px; color: #b9d7ee; font-size: 12px; }
.marker-card .marker-row { display: flex; gap: 10px; align-items: flex-start; }
.marker-card .marker-row .field { flex: 1; }
.marker-card .marker-row .field > label { white-space: nowrap; }
.marker-card #marker-color { width: 100%; height: 32px; padding: 2px; }
.marker-card #marker-name, .marker-card #marker-note, .marker-card #marker-lat, .marker-card #marker-lon,
.marker-card #marker-lat-dms, .marker-card #marker-lon-dms { width: 100%; box-sizing: border-box; }
'''
p2=r'G:\sh\local-earth\css\app.css'
a=open(p2,encoding='utf-8').read()
if '坐标标点：表单纵向布局修正' not in a:
 a=a.rstrip('\n')+'\n'+css
 open(p2,'w',encoding='utf-8',newline='').write(a)
print('markers list/count/css fixed')
