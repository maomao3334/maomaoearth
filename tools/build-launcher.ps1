# 编译 MaoMaoEarth 启动器（无需 .NET SDK / Node / Electron）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = 'G:\sh\local-earth' }
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（需要 .NET Framework 4.x）' }
$src = Join-Path $root 'packaging\MaoMaoEarthLauncher.cs'
$out = Join-Path $root 'MaoMaoEarth.exe'
& $csc /nologo /target:exe /out:$out /platform:anycpu $src
if (-not (Test-Path $out)) { throw '编译失败' }
Write-Host ("已生成 " + $out + " (" + (Get-Item $out).Length + " B)") -ForegroundColor Green