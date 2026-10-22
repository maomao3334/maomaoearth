# 坐标标点（v0.6.0）

## 功能

- **十进制度 / 度分秒双模式**
  - 十进制度：`25.123456, 102.567890`
  - 度分秒：`25°07′24.5″N, 102°34′02.1″E`
  - 支持单行粘贴，自动解析并实时显示两种格式。
- **地图选点 / 取视图中心**
  - 在对话框点「地图选点」后单击地图，坐标自动回填。
- **标记点**
  - 自定义名称（默认“标记点 N”）、备注、颜色；
  - 图钉/点 + 名称标签常显（可关闭标签）；
  - 高度：贴地或自定义米数；
  - 点击标记显示名称、备注、两种坐标格式、高度。
- **标记点列表**
  - 搜索名称/坐标，定位、编辑、删除；
  - 坐标显示可切换十进制度/度分秒。
- **拖拽移动**
  - 直接拖动标记点微调位置。
- **批量/导入导出**
  - 批量粘贴：每行 `名称,纬度,经度[,高度]`，也支持度分秒；
  - 导入 CSV / GeoJSON（Point）；
  - 导出 CSV / GeoJSON / KML。
- **工程保存**
  - 标记点名称、备注、坐标、高度、颜色、标签开关写入 `.leproj`，重开恢复。
- **API**
  - `MaoMaoEarth.markers.*` 与 `window.LEMarkers`（见下）。

## 使用

侧栏「坐标标点」：

1. 点「坐标标点…」；
2. 选择「十进制度」或「度分秒」，输入/粘贴坐标；
3. 填名称、备注、颜色、高度；
4. 点「地图选点」可在地图上直接拾取；
5. 点「标记」。

侧栏「标记点列表…」可管理、导入、导出。

## 度分秒输入

支持以下写法（推荐带半球）：

```
25°07′24.5″N, 102°34′02.1″E
25 07 24.5 N, 102 34 02.1 E
N25 07 24.5, E102 34 02.1
```

十进制度支持负数表示南纬/西经：`-25.123456, -102.567890`。

## API

```js
await MaoMaoEarth.markers.add({
  name: '观测点 A',
  lat: 25.123456,
  lon: 102.567890,
  note: '备注',
  color: '#ffd166',
  heightMode: 'clamp', // 或 'absolute'
  height: 0,
  labelVisible: true,
});

MaoMaoEarth.markers.list();
MaoMaoEarth.markers.remove(id);
MaoMaoEarth.markers.openDialog(record?);
MaoMaoEarth.markers.openList();
MaoMaoEarth.markers.exportCsv();
MaoMaoEarth.markers.exportGeoJSON();
MaoMaoEarth.markers.exportKml();
MaoMaoEarth.markers.importCsvText(csvText);
```

底层：`window.LEMarkers`（`add/addMany/remove/clear/list/openDialog/openList/getProjectState/restoreProjectState/importCsvText/importGeoJsonText/exportCsv/exportGeoJSON/exportKml/parsePair/parseDms/formatDms/formatDecimal`）。

## 限制

- 仅 **WGS84 经纬度**；不做 CGCS2000/UTM 等投影转换。
- 标记点保存到 `.leproj`，不写入 KML/KMZ 原文件。
- KML 导出为 Point Placemark；不导出图标/样式主题。
- 拖拽使用屏幕拾取，复杂地形边缘可能有少量偏差。

## 验证

- 十进制度/度分秒解析：`25°07′24.5″N` → `25.123472`。
- DMS 界面保存、名称标签、列表计数正常。
- 地图选点：点击地图回填坐标。
- 拖拽：屏幕移动后经纬度更新。
- CSV/GeoJSON 导入、工程 capture/restore 均通过。
- 截图：`docs/screenshots/13-markers.png`、`docs/screenshots/14-markers-map.png`。
