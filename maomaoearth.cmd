@echo off
rem MaomaoEarth CLI 包装（Windows）
rem 用法：maomaoearth.cmd open | serve --port 8123 | check | stop | windninja <目录>
setlocal
"%~dp0MaoMaoEarth.exe" %*
endlocal
