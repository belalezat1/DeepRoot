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
  if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed" }
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

$deployArgs = @(
  '--location', $Location,
  '--template-file', (Join-Path $infra 'main.bicep'),
  '--parameters', (Join-Path $infra 'main.bicepparam')
)
foreach ($name in $externalSettings.Keys) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not $value -and $existingSettings) { $value = $existingSettings.$name }
  if (-not $value) { Write-Warning "$name is not set; it will be left out of the app settings." }
  $deployArgs += '--parameters', "$($externalSettings[$name])=$value"
}

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
