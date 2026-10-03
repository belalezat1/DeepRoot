# Copies the deployed app settings into ignored local files so local runs use the same configuration.
# Writes api/.env (scripts and tests) and api/local.settings.json (Azure Functions). Never commit either file.
# Deployed values replace matching lines in api/.env; any other lines there are kept.
$ErrorActionPreference = 'Stop'
$apiDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'api'

$json = az staticwebapp appsettings list -n deeproot-web-ya332 -g rg-deeproot --query properties -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not read app settings. Run az login and infra/deploy.ps1 first.' }

$values = [ordered]@{}
($json | ConvertFrom-Json).PSObject.Properties | Sort-Object Name | ForEach-Object { $values[$_.Name] = $_.Value }
# Locally, Linear issues should link back to the local frontend, not the deployed site.
$values['APP_BASE_URL'] = 'http://localhost:5173'

$envPath = Join-Path $apiDir '.env'
$kept = @()
if (Test-Path $envPath) {
  $kept = Get-Content $envPath | Where-Object { -not ($_ -match '^([A-Z0-9_]+)=' -and $values.Contains($Matches[1])) }
}
$lines = @($values.Keys | ForEach-Object { "$_=$($values[$_])" }) + $kept

$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($envPath, (($lines -join "`n").TrimEnd() + "`n"), $utf8)

$functionsValues = [ordered]@{ FUNCTIONS_WORKER_RUNTIME = 'node' }
foreach ($key in $values.Keys) { $functionsValues[$key] = $values[$key] }
$localSettings = [ordered]@{ IsEncrypted = $false; Values = $functionsValues } | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $apiDir 'local.settings.json'), $localSettings, $utf8)

Write-Host "Wrote api/.env and api/local.settings.json with $($values.Count) deployed settings ($($kept.Count) other lines kept)."
