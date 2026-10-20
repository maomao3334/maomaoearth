#requires -Version 5.1
<#
  本地地球 Local Earth — 本地静态服务器（仅监听 127.0.0.1，不访问外网）
  用法：双击 start.cmd，或 powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8123
#>
[CmdletBinding()]
param(
  [int]$Port = 8123,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$Root = [System.IO.Path]::GetFullPath($Root)

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.geojson' = 'application/geo+json; charset=utf-8'
  '.kml'  = 'application/vnd.google-earth.kml+xml'
  '.kmz'  = 'application/vnd.google-earth.kmz'
  '.xml'  = 'application/xml; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.wasm' = 'application/wasm'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.bin'  = 'application/octet-stream'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.map'  = 'application/json; charset=utf-8'
  '.terrain' = 'application/octet-stream'
}

function Find-FreePort([int]$start) {
  for ($p = $start; $p -lt ($start + 40); $p++) {
    $listener = $null
    try {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
      $listener.Start()
      $listener.Stop()
      return $p
    } catch {
      if ($listener) { try { $listener.Stop() } catch {} }
    }
  }
  return $null
}

function Open-Browser([int]$port) {
  $url = "http://127.0.0.1:$port/"
  $edge = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  $chrome = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

  $browser = if ($edge) { $edge } elseif ($chrome) { $chrome } else { $null }
  if ($browser) {
    # 用应用窗口模式，界面更接近桌面 GIS
    Start-Process -FilePath $browser -ArgumentList @("--app=$url", '--window-size=1440,900')
  } else {
    Start-Process $url
  }
}

function Send-Response($ctx, [int]$status, [string]$contentType, [byte[]]$body) {
  $res = $ctx.Response
  $res.StatusCode = $status
  $res.ContentType = $contentType
  $res.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
  $res.Headers['X-Content-Type-Options'] = 'nosniff'
  if ($null -eq $body) { $body = [byte[]]@() }
  $res.ContentLength64 = $body.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD' -and $body.Length -gt 0) {
    $res.OutputStream.Write($body, 0, $body.Length)
  }
  $res.OutputStream.Close()
}

$port = Find-FreePort $Port
if (-not $port) {
  Write-Host "错误：找不到可用端口（$Port 起 40 个端口都被占用）。" -ForegroundColor Red
  exit 1
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$port/"
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "无法启动本地服务器：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "提示：某些环境需要管理员权限绑定端口；可尝试其它端口，例如 -Port 9000。"
  exit 1
}

Write-Host ""
Write-Host "  本地地球 Local Earth" -ForegroundColor Cyan
Write-Host "  地址：$prefix" -ForegroundColor Green
Write-Host "  数据目录：$Root" -ForegroundColor DarkGray
Write-Host "  完全离线：仅监听 127.0.0.1，不向互联网发起请求。" -ForegroundColor DarkGray
Write-Host "  关闭：在此窗口按 Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) { Open-Browser $port }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($rel -eq '/' -or $rel -eq '') { $rel = '/index.html' }
      $rel = $rel.Replace('/', '\').TrimStart('\')
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

      if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $ctx 403 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('403 Forbidden'))
        continue
      }
      if ((Test-Path $full) -and (Get-Item $full).PSIsContainer) {
        $full = Join-Path $full 'index.html'
      }
      if (-not (Test-Path $full -PathType Leaf)) {
        Send-Response $ctx 404 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel"))
        Write-Host ("404 " + $req.HttpMethod + " " + $req.Url.AbsolutePath) -ForegroundColor DarkYellow
        continue
      }

      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $ctype = $Mime[$ext]
      if (-not $ctype) { $ctype = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      Send-Response $ctx 200 $ctype $bytes
      Write-Host ("200 " + $req.HttpMethod + " " + $req.Url.AbsolutePath + " (" + $bytes.Length + " B)") -ForegroundColor DarkGray
    } catch {
      try {
        Send-Response $ctx 500 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes('500 Internal Server Error'))
      } catch {}
      Write-Host ("500 " + $req.HttpMethod + " " + $req.Url.AbsolutePath + " : " + $_.Exception.Message) -ForegroundColor Red
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch {}
  Write-Host ""
  Write-Host "本地服务器已停止。" -ForegroundColor DarkGray
}
