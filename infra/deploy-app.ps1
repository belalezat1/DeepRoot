# Builds the Functions bundle and deploys it, with the frontend, to the Static Web App.
# Usage: .\infra\deploy-app.ps1                 (fresh live frontend and Functions build)
#        .\infra\deploy-app.ps1 -AppDir <path>  (a different built frontend folder)
param([string]$AppDir)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Push-Location $root
try {
  npm run build:functions -w api
  if ($LASTEXITCODE -ne 0) { throw 'Functions build failed' }

  if (-not $AppDir) {
    $previousMode = $env:VITE_API_MODE
    try { $env:VITE_API_MODE = 'live'; npm run build -w web; if ($LASTEXITCODE -ne 0) { throw 'Live frontend build failed' } }
    finally { $env:VITE_API_MODE = $previousMode }
    $AppDir = Join-Path $root 'web\dist'
  }
  if (-not (Test-Path (Join-Path $AppDir 'index.html'))) {
    throw "Missing built frontend at $AppDir. Deployment aborted."
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
