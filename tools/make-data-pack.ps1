# 生成 GitHub Release 用的离线数据包（data 目录）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = 'G:\sh\local-earth' }
$data = Join-Path $root 'data'
if (-not (Test-Path $data)) { throw '找不到 data 目录' }
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$zip = Join-Path $release ("maomaoearth-data-" + $stamp + ".zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host ("正在打包 " + $data + " -> " + $zip) -ForegroundColor Cyan
[System.IO.Compression.ZipFile]::CreateFromDirectory($data, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ("完成：" + $zip + " (" + $mb + " MB)") -ForegroundColor Green
Write-Host "上传：gh release upload <tag> <zip> --repo <owner>/maomaoearth" -ForegroundColor DarkGray