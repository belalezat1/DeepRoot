# Deploys Deeproot's Azure resources and the Search index. Safe to rerun.
# Usage: .\infra\deploy.ps1            (apply)
#        .\infra\deploy.ps1 -WhatIf    (preview only)
param(
  [switch]$WhatIf,
  [string]$Location = 'eastus2'
)

$ErrorActionPreference = 'Stop'
$infra = $PSScriptRoot

function Invoke-Az {
  $output = & az @args
  if ($LASTEXITCODE -ne 0) { throw "Azure CLI command failed (arguments omitted to protect settings)." }
  $output
}

# The app-settings resource replaces every setting, so carry forward values that come from outside Azure
# unless a new value is set in the environment, e.g. $env:GEMINI_API_KEY = '<key>'.
$externalSettings = [ordered]@{
  GEMINI_API_KEY  = 'geminiApiKey'
  LINEAR_API_KEY  = 'linearApiKey'
  LINEAR_TEAM_ID  = 'linearTeamId'
  LINEAR_TEAM_KEY = 'linearTeamKey'
}
$existingSettings = $null
$siteId = Invoke-Az resource list --name deeproot-web-ya332 --resource-type Microsoft.Web/staticSites --query '[0].id' -o tsv
if ($siteId) {
  $existingSettings = (Invoke-Az staticwebapp appsettings list -n deeproot-web-ya332 -g rg-deeproot -o json | ConvertFrom-Json).properties
}

# Every parameter goes in one temporary JSON file: the CLI refuses to mix a .bicepparam file with a JSON
# parameter file, and a file keeps keys off the command line. Start from main.bicepparam, compiled to JSON.
$compiled = Invoke-Az bicep build-params --file (Join-Path $infra 'main.bicepparam') --stdout | Out-String | ConvertFrom-Json
$parameters = ($compiled.parametersJson | ConvertFrom-Json).parameters

foreach ($name in $externalSettings.Keys) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not $value -and $existingSettings) { $value = $existingSettings.$name }
  if (-not $value) { Write-Warning "$name is not set; it will be left out of the app settings." }
  $parameters | Add-Member -Force -NotePropertyName $externalSettings[$name] -NotePropertyValue @{ value = "$value" }
}

# Preserve trusted routing and connector credentials. Secure parameter file avoids exposing values in logs.
$connectorSettings = @{}
$connectorNames = @('EMAIL_ROUTING_JSON', 'CONNECTOR_ACCOUNT_MAPS_JSON', 'CONNECTOR_POLICIES_JSON', 'CONNECTOR_HTTP_JSON', 'ENABLE_DEMO_APPS', 'DEMO_APP_ACCOUNT_IDS', 'DEMO_APPS_TOKEN', 'DEMO_APPS_BASE_URL')
if ($existingSettings) { $existingSettings.PSObject.Properties | Where-Object { $_.Name -in $connectorNames -or $_.Name -like 'CONNECTOR_TOKEN_*' } | ForEach-Object { $connectorSettings[$_.Name] = $_.Value } }
foreach ($name in $connectorNames) { $value = [Environment]::GetEnvironmentVariable($name); if ($null -ne $value) { $connectorSettings[$name] = $value } }
# tokenEnv may reference a custom variable; preserve that exact setting too.
if ($connectorSettings.ContainsKey('CONNECTOR_HTTP_JSON')) {
  $http = $connectorSettings['CONNECTOR_HTTP_JSON'] | ConvertFrom-Json
  $http.PSObject.Properties | ForEach-Object {
    $name = $_.Value.tokenEnv
    if ($name) { $value = [Environment]::GetEnvironmentVariable($name); if ($null -eq $value -and $existingSettings) { $value = $existingSettings.$name }; if ($null -ne $value) { $connectorSettings[$name] = $value } }
  }
}
$parameters | Add-Member -Force -NotePropertyName connectorSettings -NotePropertyValue @{ value = $connectorSettings }

$connectorFile = Join-Path ([IO.Path]::GetTempPath()) ('deeproot-settings-' + [guid]::NewGuid().ToString() + '.json')
$parametersJson = @{
  '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
  contentVersion = '1.0.0.0'
  parameters = $parameters
} | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($connectorFile, $parametersJson, (New-Object System.Text.UTF8Encoding $false))
$deployArgs = @(
  '--location', $Location,
  '--template-file', (Join-Path $infra 'main.bicep'),
  '--parameters', ('@' + $connectorFile)
)
try {
if ($WhatIf) {
  Invoke-Az deployment sub what-if @deployArgs --result-format ResourceIdOnly
  return
}

Write-Host 'Deploying Azure resources (Cosmos DB can take several minutes)...'
$outputs = Invoke-Az deployment sub create --name "deeproot-$(Get-Date -Format yyyyMMddHHmmss)" @deployArgs --query properties.outputs -o json | ConvertFrom-Json

$resourceGroup = $outputs.resourceGroupName.value
$searchName = $outputs.searchServiceName.value
$indexName = $outputs.searchIndexName.value

Write-Host "Creating or updating Search index '$indexName'..."
$adminKey = Invoke-Az search admin-key show --service-name $searchName -g $resourceGroup --query primaryKey -o tsv
$indexBody = Get-Content (Join-Path $infra 'search-index.json') -Raw
Invoke-RestMethod -Method Put `
  -Uri "$($outputs.searchEndpoint.value)/indexes/$($indexName)?api-version=2024-07-01" `
  -Headers @{ 'api-key' = $adminKey } -ContentType 'application/json' -Body $indexBody | Out-Null

Write-Host ''
Write-Host 'Deployed:'
$outputs.PSObject.Properties | ForEach-Object { '  {0,-20} {1}' -f $_.Name, $_.Value.value }

} finally { Remove-Item -Force $connectorFile -ErrorAction SilentlyContinue }
