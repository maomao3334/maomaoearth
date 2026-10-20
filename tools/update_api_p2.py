p=r'G:\sh\local-earth\docs\API.md'
c=open(p,encoding='utf-8').read()
add="""

## P2：粒子 / 风廓线 / 地名增强 / HTML 快照

```js
// 风场粒子
MaoMaoEarth.particles.start({density: 1200});
MaoMaoEarth.particles.setDensity(2200);
MaoMaoEarth.particles.setMode('particles' | 'arrows' | 'both');
MaoMaoEarth.particles.getStats();
MaoMaoEarth.particles.stop();

// 垂直风廓线 / 3D 高度切片
MaoMaoEarth.windProfile.open();
MaoMaoEarth.windProfile.setPoint(102.4, 25.05);
MaoMaoEarth.windProfile.getData();
MaoMaoEarth.windProfile.setSlices(true);

// 地名/坐标搜索
MaoMaoEarth.places.search('昆明');
MaoMaoEarth.places.search('102.4,25.05');
MaoMaoEarth.places.flyTo(item);
MaoMaoEarth.places.getRecent();

// HTML 快照 / 分享
MaoMaoEarth.snapshot.html({title: '我的风场'});
MaoMaoEarth.snapshot.downloadHtml();
MaoMaoEarth.snapshot.shareLink();
MaoMaoEarth.snapshot.copyShare();
```
"""
if '## P2：粒子' not in c:
    c += add
open(p,'w',encoding='utf-8',newline='').write(c)
print('P2 API doc added')
