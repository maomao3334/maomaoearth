# P2 · 离线地名 / 坐标搜索增强（js/places.js）

在保留原有 `LETools` 自然地球（Natural Earth）地名搜索的基础上，增加：

- 内置离线中国城市地名库 `data/public/places/zh-cities.json`（**413 条**）；
- 中文名 / 拼音 / 拼音首字母 / 别名搜索；
- `经度,纬度` 或 `经度 纬度` 坐标直达；
- 统一下拉结果、↑/↓/Enter 键盘操作、最近搜索（localStorage）；
- 顶部搜索框右侧显示「地名 413」徽标。

## 1. 数据集

`data/public/places/zh-cities.json`（UTF-8，约 76 KB）：

```json
{
  "name": "中国城市离线地名库",
  "source": "Natural Earth populated places (public domain) + 人工整理中文名",
  "version": 1,
  "count": 413,
  "places": [
    {"name":"昆明","pinyin":"kunming","aliases":["Kunming","昆明市","春城"],
     "lon":102.67803,"lat":25.07193,"level":"省会"}
  ]
}
```

- 字段：`name`（中文）、`pinyin`（无声调全拼）、`aliases`（英文名/旧称/简称/「市」后缀等）、
  `lon`/`lat`、`level`（直辖市 / 省会 / 特别行政区 / 地级市 / 县级市）。
- 来源：Natural Earth `ne_10m_populated_places_simple` 的中国 400 个居民点 + 人工中文名映射，
  另补充香港、澳门、台北、高雄、台中、三沙、景洪、香格里拉、张家界、呼伦贝尔、鄂尔多斯、
  义乌、昆山、武夷山、九寨沟等条目；经纬度直接取 Natural Earth 坐标（城市点位，精度约 0.01°）。
- 生成脚本在开发环境离线运行（读取本地 GeoJSON），运行时不联网、不依赖第三方库。

## 2. 搜索规则

输入统一 trim + 小写后：

1. 先识别坐标：`^\s*(-?\d+(?:\.\d+)?)\s*[,，;；\s]\s*(-?\d+(?:\.\d+)?)\s*$`，
   要求经度 −180–180、纬度 −90–90；首项按**经度**、次项按**纬度**（`102.4,25.05`）。
2. 本地地名库匹配（按分数排序）：
   - 中文名精确 → 拼音/首字母精确 → 别名精确 → 中文名前缀 → 拼音前缀 → 首字母前缀 →
     别名前缀 → 中文名包含 → 拼音包含；
   - 同分时按等级（直辖市/省会/地级市/县级市）与名称长度排序，最多取 8 条。
3. 合并原有索引：调用 `LETools.search(q)`（仍会重建索引，新导入图层可立即搜到），
   按经纬度 0.02° 与同名去重，最多 12 条；原有结果保留 `entity`，点击时仍走
   `LETools.gotoItem`（对实体飞行），因此原搜索行为不回归。

拼音首字母：内置普通话音节表，对连续拼音做“最长音节匹配”后取首字母，
例如 `beijing→bj`、`kunming→km`、`shijiazhuang→sjz`；多音/歧义（如 `xian`）通过
数据里的别名（`XA` 等）兜底。

## 3. 交互

- 输入框（顶部 `#search-input`）仍使用原来的 `.searchbox` / `#search-results` DOM 与样式；
  `places.js` 在**捕获阶段**接管 `input/focus/keydown`（`stopImmediatePropagation`），
  自身调用 `LETools.search` 合并结果，因此不会与 `tools.js` 的旧渲染重复。
- 键盘：↑/↓ 选择、Enter 飞到、Esc 关闭并失焦；`Ctrl/⌘+F`（ui.js 提供）仍可聚焦搜索。
- 结果项显示「名称 + 拼音 + 类型」，底部显示数据条数与操作提示。
- 点击结果：本地条目走 `LE.flyTo`（城市默认 40 km 高），坐标条目默认 12 km，
  原有索引实体仍走 `LETools.gotoItem`；输入框失焦、状态栏显示「已飞到：…」。
- 最近搜索：`localStorage` key `localEarth.searchRecent`，最多 8 条；空输入聚焦时显示
  「最近搜索」分组，可点「清除」；`LEPlaces.clearRecent()` 同步清空。

## 4. 对外 API

```js
window.LEPlaces = {
  init(le),
  isReady(),
  getDatasetStats(),        // {ready, failed, count, recent, url}
  search(q),                // [{name,lon,lat,height,kind,source,entity?}]
  flyTo(item),
  getRecent(),
  clearRecent(),
  getResults(),
  toAbbr(pinyin)            // 'beijing' → 'bj'
};
```

## 5. 自测结果（headless Edge + CDP）

- 地名库加载：`ready=true`，`count=413`，顶部徽标「地名 413」。
- `search('昆明')` → 昆明（省会）；`search('kunming')` → 昆明；
  `search('北京')` / `search('Peking')` → 北京（直辖市）；
  `search('bj')` → 北京、宝鸡（均为 bj 首字母，符合预期）；
  `search('dali')` → 大理、大荔、大连（按精确/前缀排序）。
- 坐标：`search('102.4,25.05')` → 「坐标 102.4, 25.05」，Enter 后相机到 102.401, 25.05（12 km 高）。
- 键盘：Enter 飞行昆明；↑/↓ + Enter 飞行北京。
- 最近搜索：飞行后写入 localStorage（3 条示例），空输入聚焦显示「最近搜索」；
  `clearRecent()` 后 localStorage 变为 `[]`。
- 原有 Natural Earth 搜索仍在：`LETools.search('Tokyo')=1`、`LETools.search('Paris')=1`，
  `LEPlaces.search('Tokyo')` 命中「Tokyo（城市/地名）」。
- 截图：`docs/testdata/p2-search.png`（昆明下拉 + 本地地名徽标）。
- 无 page-error / console.error。

## 6. 限制

- 数据范围仅中国城市（413 条：4 直辖市、27 省会、2 特别行政区、210 地级市、170 县级市），
  不含街道/POI/国外地名；国外地名仍依赖原有 Natural Earth 索引。
- 经纬度为城市点位（Natural Earth），不是行政中心精确坐标；用于搜索飞行足够。
- 拼音首字母采用启发式音节切分，极少数多音字/歧义划分可能不准确，可用全拼或中文名。
- 最近搜索保存在 localStorage，隐私模式或无存储环境下会退化为仅本次会话有效。
- 合并结果按坐标近似去重（0.02°），极近的两个不同地点可能被合并为一条。
