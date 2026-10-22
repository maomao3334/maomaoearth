p=r'G:\sh\local-earth\docs\API.md'
c=open(p,encoding='utf-8').read()
add='''

## 坐标标点（v0.6.0）

```js
MaoMaoEarth.markers.add(record, { fly: true });
MaoMaoEarth.markers.list();
MaoMaoEarth.markers.remove(id);
MaoMaoEarth.markers.clear();
MaoMaoEarth.markers.openDialog(record?);
MaoMaoEarth.markers.openList();
MaoMaoEarth.markers.exportCsv();
MaoMaoEarth.markers.exportGeoJSON();
MaoMaoEarth.markers.exportKml();
MaoMaoEarth.markers.importCsvText(text);
```

`record`：`{ name, lat, lon, note?, color?, heightMode:'clamp'|'absolute', height?, labelVisible? }`。
底层 `window.LEMarkers` 另含 `parsePair/parseDms/formatDms/formatDecimal`。详见 [MARKERS.md](MARKERS.md)。
'''
if '## 坐标标点（v0.6.0）' not in c:
 c=c.rstrip('\n')+add
 open(p,'w',encoding='utf-8',newline='').write(c)
print('api doc appended')
