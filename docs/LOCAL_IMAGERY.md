# 本地影像（仅本机，不进入 GitHub）

MaomaoEarth 支持把**只在本机使用**的影像切成离线 XYZ 瓦片，并自动加载。当前实例为北京市正射影像（ENVI 镶嵌），代码和文档可以上传 GitHub，但**影像瓦片、清单、原始数据一律不进入 Git / Release**。

## 1. 数据情况

| 项目 | 值 |
|---|---|
| 原始文件 | `C:\Users\A\Downloads\PEK` + `PEK.HDR`（ENVI Standard） |
| 尺寸 | 45496 × 35511 × 4 波段，uint8，BSQ |
| 投影 | Geographic Lat/Lon，WGS-84 |
| 像素 | 4.63e-5°（约 5 m） |
| 左上角像素中心 | 115.40556479, 41.06829032 |
| 覆盖 | W 115.4055° / E 117.5120° / S 39.4242° / N 41.0683°（北京市域镶嵌） |
| 波段 | 实测为 **B, G, R, NIR**；显示取 band3/band2/band1 → RGB |

原始文件约 6.46 GB，**不要**复制进项目目录。

## 2. 生成离线瓦片

```bat
:: 全量：z8–z15，WebMercator XYZ
python tools\prepare_pek_ortho.py --src "C:\Users\A\Downloads\PEK"

:: 快速测试：只生成 z10–z12 的前 40 张
python tools\prepare_pek_ortho.py --src "C:\Users\A\Downloads\PEK" --minzoom 10 --maxzoom 12 --max-tiles 40

:: 只生成一张瓦片，检查色彩/几何
python tools\prepare_pek_ortho.py --src "C:\Users\A\Downloads\PEK" --tile 15/26978/12416
```

生成结果：

```text
data/local/
  imagery.json                       # 应用读取的清单（自动生成）
  beijing-ortho/
    tiles/{z}/{x}/{y}.jpg            # 完整瓦片（JPEG q84）
    tiles/{z}/{x}/{y}.png            # 含 no-data 边界的瓦片（RGBA 透明）
```

- 投影像素：WebMercator（EPSG:3857），与 Cesium 默认切片一致。
- `{z}` 8–15，`{x}/{y}` 为 XYZ（y 从北往南）。
- 完整瓦片约 15–25 KB；边界 PNG 稍大，带透明 alpha。
- 调色：`--black 0 --white 202 --gamma 0.76`（默认值，可按观感调整）。
- 重跑默认覆盖同名瓦片；需要彻底重建时手动删除 `data/local/beijing-ortho`。

本次本机全量生成（2026-10-22）：

| 项目 | 统计 |
|---|---|
| 瓦片总数 | **27,586**（JPEG 25,059 + PNG 2,527） |
| 占用 | **566.6 MB** |
| 生成用时 | 573.9 s（约 9.6 分钟） |
| 各级瓦片 | z8 5 / z9 11 / z10 32 / z11 108 / z12 374 / z13 1,368 / z14 5,239 / z15 20,449 |
| 分块位置 | `data/local/beijing-ortho/tiles/<z>/<x>/<y>.jpg|.png` |

## 3. 应用内使用

- 启动后自动读取 `data/local/imagery.json`，并自动加载 `autoLoad` 的数据集；
- 侧栏出现 **「本地影像」** 卡片：显示 `z8–15`、加载状态，支持 **加载/移除** 与 **定位**；
- 图层管理器里名称为 **「本地影像 · 北京正射影像」**，可切换显隐、调透明度、上移/下移；
- 本地影像始终保持在卫星影像之上（地形/画质切换后会自动重新提层）；
- 工程文件 `.leproj` **不保存**本地影像图层，打开工程后由 `data/local` 自动恢复；
- JS API：

```js
await MaoMaoEarth.ready();
MaoMaoEarth.localImagery.list();            // 数据集列表与加载状态
MaoMaoEarth.localImagery.load('beijing-ortho');   // 加载
MaoMaoEarth.localImagery.unload('beijing-ortho'); // 移除
```

## 4. 不上传 GitHub 的保证

`.gitignore` 已加入：

```gitignore
# 仅本机数据：北京正射等本地影像，绝不进入 Git / 发布包
data/local/
```

因此：

- `git status` 不会出现 `data/local/`；
- `git archive` / Release 程序包不包含该目录；
- 打包/上传前可用以下命令自检：

```bat
git status --porcelain
git archive --format=zip --output=%TEMP%\check.zip HEAD
tar -tf %TEMP%\check.zip | findstr /i "data/local"   :: 应无输出
```

## 5. 性能与限制

- 瓦片按需 HTTP 读取，静态服务器只监听 `127.0.0.1`；首次浏览到北京时会有一次磁盘读取，之后走浏览器缓存。
- 高倍瓦片数量较多（全量 2.75 万张，z15 约 2.0 万张），首次生成需要约 10 分钟；生成脚本按行读取源影像并流式写瓦片，内存峰值约 300 MB。
- 仅覆盖北京市域，域外瓦片不存在；应用端对 404 返回透明瓦片，不会显示黑边。
- 原始数据版权/使用限制由数据提供方决定；本机自用，不再分发。

## 6. 验证记录

- 单瓦片几何：`z15/26978/12416` 覆盖 116.3892–116.4001°E、39.9013–39.9097°N（天安门/故宫一带），色彩与原始 BGR 波段一致。
- 应用内：清单自动加载、侧栏卡片、图层名、显隐/移除/重新加载、无 page-error。
- 2026-10-22 本机生成：见 `data/local/beijing-ortho`（该目录不在 Git 中）。
