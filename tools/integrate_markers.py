# index
p=r'G:\sh\local-earth\index.html'
c=open(p,encoding='utf-8').read()
anchor='''      </section>

      <section class="side-section" id="data-section">'''
marker='''      </section>

      <section class="side-section" id="marker-section">
        <h3>坐标标点 <span id="marker-count" class="count">0</span></h3>
        <button id="btn-marker-add" class="wide" title="输入经纬度/度分秒并标记点">坐标标点…</button>
        <button id="btn-marker-list" class="wide" title="查看、编辑、导入导出标记点">标记点列表…</button>
      </section>

      <section class="side-section" id="data-section">'''
assert anchor in c
c=c.replace(anchor,marker,1)
c=c.replace('  <script src="js/draw.js"></script>','  <script src="js/draw.js"></script>\n  <script src="js/markers.js"></script>',1)
open(p,'w',encoding='utf-8',newline='').write(c)
# api
p2=r'G:\sh\local-earth\js\api.js'
a=open(p2,encoding='utf-8').read()
anchor2='''    /** 性能 */
    perf: {'''
add='''    /** 坐标标点 */
    markers: {
      add: function (record, opts) { return requireModule('LEMarkers', 'add').add(record, opts); },
      addMany: function (records, opts) { return requireModule('LEMarkers', 'addMany').addMany(records, opts); },
      remove: function (id) { return requireModule('LEMarkers', 'remove').remove(id); },
      clear: function () { return requireModule('LEMarkers', 'clear').clear(); },
      list: function () { return requireModule('LEMarkers', 'list').list(); },
      openDialog: function (record) { return requireModule('LEMarkers', 'openDialog').openDialog(record); },
      openList: function () { return requireModule('LEMarkers', 'openList').openList(); },
      getProjectState: function () { return requireModule('LEMarkers', 'getProjectState').getProjectState(); },
      restoreProjectState: function (records) { return requireModule('LEMarkers', 'restoreProjectState').restoreProjectState(records); },
      exportCsv: function () { return requireModule('LEMarkers', 'exportCsv').exportCsv(); },
      exportGeoJSON: function () { return requireModule('LEMarkers', 'exportGeoJSON').exportGeoJSON(); },
      exportKml: function () { return requireModule('LEMarkers', 'exportKml').exportKml(); },
    },

    /** 性能 */
    perf: {'''
assert anchor2 in a
a=a.replace(anchor2,add,1)
open(p2,'w',encoding='utf-8',newline='').write(a)
# project
p3=r'G:\sh\local-earth\js\project.js'
d=open(p3,encoding='utf-8').read()
d=d.replace("      if (layer.type === 'wind3d') continue; // 鐢?windninja 娈佃褰?      if (isTerrainManaged(layer)) continue;", "      if (layer.id === 'markers') continue; // 标记点单独保存\n      if (layer.type === 'wind3d') continue; // 鐢?windninja 娈佃褰?      if (isTerrainManaged(layer)) continue;",1)
# Add markers capture before return project
old='''    if (W && typeof W.getProjectState === 'function') {
      try {
        project.windninja = W.getProjectState();
      } catch (err) {
        console.warn('[LEProject] 鎶撳彇 Wind3D 鐘舵€佸け璐?, err);
      }
    }
    return project;'''
new='''    if (W && typeof W.getProjectState === 'function') {
      try {
        project.windninja = W.getProjectState();
      } catch (err) {
        console.warn('[LEProject] 鎶撳彇 Wind3D 鐘舵€佸け璐?, err);
      }
    }
    if (window.LEMarkers && typeof LEMarkers.getProjectState === 'function') {
      try {
        project.markers = LEMarkers.getProjectState();
      } catch (err) {
        console.warn('[LEProject] 抓取标记点失败', err);
      }
    }
    return project;'''
assert old in d
d=d.replace(old,new,1)
# Add applyMarkers function before apply
anchor3='''  async function apply(project) {'''
func='''  async function applyMarkers(project, warnings) {
    const M = window.LEMarkers;
    if (!M || typeof M.restoreProjectState !== 'function') return;
    try {
      await M.restoreProjectState(project.markers || []);
    } catch (err) {
      warnings.push('标记点恢复失败：' + err.message);
    }
  }

  async function apply(project) {'''
assert anchor3 in d
d=d.replace(anchor3,func,1)
# call applyMarkers after windninja
d=d.replace('    await applyWindninja(project, warnings);\n    applyCamera(project);','    await applyWindninja(project, warnings);\n    await applyMarkers(project, warnings);\n    applyCamera(project);',1)
open(p3,'w',encoding='utf-8',newline='').write(d)
print('index/api/project patched')
