p=r'G:\sh\local-earth\js\project.js'
d=open(p,encoding='utf-8').read()
# skip marker layer
old='      if (layer.type === \'wind3d\') continue;'
new='      if (layer.id === \'markers\') continue; // 标记点单独保存\n' + old
if old in d and 'layer.id === \'markers\'' not in d:
 d=d.replace(old,new,1)
# capture markers before first return project
marker='''    if (window.LEMarkers && typeof LEMarkers.getProjectState === 'function') {
      try {
        project.markers = LEMarkers.getProjectState();
      } catch (err) {
        console.warn('[LEProject] 抓取标记点失败', err);
      }
    }
'''
if 'project.markers' not in d:
 d=d.replace('    return project;\n  }\n', marker+'    return project;\n  }\n',1)
# applyMarkers function
func='''  async function applyMarkers(project, warnings) {
    const M = window.LEMarkers;
    if (!M || typeof M.restoreProjectState !== 'function') return;
    try {
      await M.restoreProjectState(project.markers || []);
    } catch (err) {
      warnings.push('标记点恢复失败：' + err.message);
    }
  }

'''
if 'function applyMarkers' not in d:
 d=d.replace('  async function apply(project) {',func+'  async function apply(project) {',1)
# call
oldcall='    await applyWindninja(project, warnings);\n    applyCamera(project);'
newcall='    await applyWindninja(project, warnings);\n    await applyMarkers(project, warnings);\n    applyCamera(project);'
if 'await applyMarkers' not in d:
 d=d.replace(oldcall,newcall,1)
open(p,'w',encoding='utf-8',newline='').write(d)
print('project patched')
