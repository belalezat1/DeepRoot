# Copies the deployed app settings into ignored local files so local runs use the same configuration.
# Writes api/local.settings.json (Azure Functions) and .env (scripts and tests). Never commit either file.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$json = az staticwebapp appsettings list -n deeproot-web-ya332 -g rg-deeproot --query properties -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not read app settings. Run az login and infra/deploy.ps1 first.' }
$settings = $json | ConvertFrom-Json

$values = [ordered]@{ FUNCTIONS_WORKER_RUNTIME = 'node' }
$settings.PSObject.Properties | Sort-Object Name | ForEach-Object { $values[$_.Name] = $_.Value }

$apiDir = Join-Path $root 'api'
New-Item -ItemType Directory -Force $apiDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
$localSettings = [ordered]@{ IsEncrypted = $false; Values = $values } | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $apiDir 'local.settings.json'), $localSettings, $utf8)

$envLines = $settings.PSObject.Properties | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }
[IO.File]::WriteAllText((Join-Path $root '.env'), (($envLines -join "`n") + "`n"), $utf8)

Write-Host "Wrote api/local.settings.json and .env with $($settings.PSObject.Properties.Name.Count) settings."
