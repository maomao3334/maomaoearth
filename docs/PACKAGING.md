# MaomaoEarth 打包与发布

## 产物

- `MaoMaoEarth.exe`：Windows 免安装启动器（.NET Framework 4.x，使用系统自带 `csc.exe` 编译，约 30 KB）
- 运行目录：`index.html`、`serve.ps1`、`js/`、`css/`、`data/`、`vendor/` 与 `MaoMaoEarth.exe` 同级
- CLI 包装：`maomaoearth.cmd`
- 浏览器版：`start.cmd` / `serve.ps1`（与打包版共用同一套前端与 API）

## 编译启动器

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-launcher.ps1
```

脚本会调用：

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:exe /out:MaoMaoEarth.exe packaging\MaoMaoEarthLauncher.cs
```

不需要安装 .NET SDK、Node、Electron；只使用 Windows 自带 .NET Framework。

## 运行

```bat
MaoMaoEarth.exe
MaoMaoEarth.exe check
MaoMaoEarth.exe serve --port 8123 --no-browser
maomaoearth.cmd stop
```

详见 [CLI.md](CLI.md)。

## 发布建议

- GitHub 仓库放**代码 + 文档 + 小型样例数据**；大体量离线数据（地形 `.bin`、卫星影像瓦片、Blue Marble 瓦片、Cesium vendor）建议作为 **GitHub Release 数据包** 附加，README 说明解压到项目根目录。
- 便携包 ZIP 结构：

```
MaomaoEarth/
  MaoMaoEarth.exe
  maomaoearth.cmd
  index.html
  serve.ps1
  js/  css/  vendor/
  data/            # 或让用户从 Release 下载 data.zip 解压到此处
  docs/
  README.md
```

- 服务只监听 `127.0.0.1`，不访问网络；发布前确认 `docs/testdata` 与 `tools` 中的临时日志已清理。
