# MaomaoEarth CLI / 免安装启动器

`MaoMaoEarth.exe` 是 Windows 免安装启动器（.NET Framework 编译，无需 Electron/Node），负责启动仅监听 `127.0.0.1` 的本地服务，并用 Edge/Chrome 的 `--app` 窗口模式打开应用。
同一目录必须包含 `index.html`、`serve.ps1` 与 `data/`。

## 命令

```bat
:: 启动服务并打开应用窗口
MaoMaoEarth.exe

:: 同上
MaoMaoEarth.exe open

:: 前台运行本地服务（CLI，适合脚本/二次开发）
MaoMaoEarth.exe serve --port 8123 --no-browser

:: 查看环境/服务状态
MaoMaoEarth.exe check

:: 停止由本启动器启动的服务（读取 .maomaoearth.pid）
MaoMaoEarth.exe stop

:: 导入 WindNinja/Wind3D 结果目录并打开
MaoMaoEarth.exe windninja "C:\path\to\windninja\...\r0200m"

:: 启动本地 MBTiles 瓦片服务并打开应用（Ctrl+C 停止）
MaoMaoEarth.exe mbtiles "D:\data\china.mbtiles"

:: 帮助
MaoMaoEarth.exe --help
```

也提供 `maomaoearth.cmd` 作为 CLI 包装：

```bat
maomaoearth check
maomaoearth serve --port 8123 --no-browser
maomaoearth windninja "D:\Wind3D\results\case\windninja\20240403T080600Z\h050m\r0200m"
maomaoearth mbtiles "D:\data\china.mbtiles"
```

## 行为说明

- 端口默认 `8123`；被占用时自动找 `8123–8182` 内空闲端口。
- 已在运行同一应用时复用（不会重复启动服务）。
- 服务进程、PID 与日志：
  - `.maomaoearth.pid`
  - `maomaoearth.log`
- `windninja <目录>` 会把目录中的 `*.asc` / `*.prj` / `*.cfg` / `*.csv` 复制到
  `data/samples/windninja/cli-<时间>-<目录名>/`，然后用
  `?windninja=<vel.asc>` 打开应用；原目录不被修改。

- `mbtiles <文件>` 会启动 C# 瓦片服务（winsqlite3.dll，127.0.0.1 随机端口 + token），
  并打开 `?mbtiles=<服务地址>&mbtoken=<token>`；启动器保持运行，Ctrl+C 停止瓦片服务。
  详见 [MBTILES.md](MBTILES.md)。

## 与浏览器版共存

不打包也可以直接运行原有方式：

```bat
start.cmd
:: 或
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8123
```

打包版只是多了 EXE 入口与 CLI；HTML/JS 与浏览器版完全一致，API 也一致。
