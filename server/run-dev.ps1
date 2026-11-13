# Starts the fusion server for local development.
# Uses Node from PATH; falls back to the Node bundled with a Unity install (WebGL/Emscripten
# tooling ships one) if none is installed. Install Node 20+ LTS from https://nodejs.org for real use.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    $candidates = Get-ChildItem "C:\Program Files\Unity\Hub\Editor\*\Editor\Data\PlaybackEngines\WebGLSupport\BuildTools\Emscripten\node\node.exe" -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        $v = (& $c.FullName --version) -replace '^v', ''
        if ([int]($v.Split('.')[0]) -ge 20) { $node = $c.FullName; break }
    }
}
if (-not $node) { throw "Node.js 20+ not found. Install it from https://nodejs.org (LTS)." }

if (-not (Test-Path 'node_modules')) {
    Write-Host "Installing dependencies..."
    & $node (Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js') install --no-audit --no-fund
}
if (-not (Test-Path '.env')) {
    Write-Host "No .env found; copying .env.example (local CSV sheet + local storage)."
    Copy-Item '.env.example' '.env'
}
if (-not (Test-Path 'local-storage\merges\*.mp4')) {
    Write-Host "No placeholder videos found; generating (python scripts/gen-placeholders.py)..."
    python scripts/gen-placeholders.py
}

Write-Host "Using $node ($(& $node --version))"
& $node src/index.js
