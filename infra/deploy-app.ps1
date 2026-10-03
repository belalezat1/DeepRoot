# Builds the frontend (live API mode) and the Functions bundle, then deploys both to the Static Web App.
# Usage: .\infra\deploy-app.ps1                 (builds web\ with VITE_API_MODE=live)
#        .\infra\deploy-app.ps1 -AppDir <path>  (deploy an already-built frontend folder instead)
param([string]$AppDir)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Push-Location $root
try {
  npm run build:functions -w api
  if ($LASTEXITCODE -ne 0) { throw 'Functions build failed' }

  if (-not $AppDir -and (Test-Path (Join-Path $root 'web\package.json'))) {
    # Without VITE_API_MODE=live the frontend shows its built-in mock data instead of calling the API.
    $env:VITE_API_MODE = 'live'
    try { npm run build -w web } finally { Remove-Item Env:VITE_API_MODE }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
  }
  if (-not $AppDir) { $AppDir = Join-Path $root 'web\dist' }
  if (-not (Test-Path (Join-Path $AppDir 'index.html'))) {
    Write-Warning "No built frontend at $AppDir; deploying a placeholder page with the API."
    $AppDir = Join-Path $env:TEMP 'deeproot-placeholder'
    New-Item -ItemType Directory -Force $AppDir | Out-Null
    Set-Content -Encoding utf8 (Join-Path $AppDir 'index.html') '<!doctype html><title>Deeproot</title><p>Deeproot API is deployed. The frontend is not deployed yet. <a href="/api/health">API health</a></p>'
  }

  $token = az staticwebapp secrets list -n deeproot-web-ya332 -g rg-deeproot --query properties.apiKey -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'Could not read the deployment token. Run az login first.' }

  # swa writes progress to stderr, which Windows PowerShell would treat as a failure; the exit code decides.
  $ErrorActionPreference = 'Continue'
  swa deploy $AppDir `
    --api-location (Join-Path $root 'api\deploy') `
    --api-language node --api-version 22 `
    --swa-config-location $PSScriptRoot `
    --deployment-token $token `
    --env production
  if ($LASTEXITCODE -ne 0) { throw 'swa deploy failed' }
} finally {
  Pop-Location
}
