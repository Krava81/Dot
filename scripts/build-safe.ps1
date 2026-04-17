$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$esbuildCandidates = @(
  "node_modules\esbuild\esbuild.exe",
  "node_modules\vite\node_modules\esbuild\esbuild.exe",
  "node_modules\@esbuild\win32-x64\esbuild.exe",
  "node_modules\vite\node_modules\esbuild\bin\esbuild"
) | ForEach-Object { Join-Path $repoRoot $_ }

foreach ($path in $esbuildCandidates) {
  if (Test-Path -LiteralPath $path) {
    try { Unblock-File -LiteralPath $path -ErrorAction Stop } catch {}
  }
}

npm run build-server
npm run build-client
