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

# The app-settings resource replaces every setting, so carry an existing Linear key forward.
$linearApiKey = $env:LINEAR_API_KEY
if (-not $linearApiKey) {
  $siteId = Invoke-Az resource list --name deeproot-web-ya332 --resource-type Microsoft.Web/staticSites --query '[0].id' -o tsv
  if ($siteId) {
    $linearApiKey = Invoke-Az staticwebapp appsettings list -n deeproot-web-ya332 -g rg-deeproot --query properties.LINEAR_API_KEY -o tsv
  }
}

$deployArgs = @(
  '--location', $Location,
  '--template-file', (Join-Path $infra 'main.bicep'),
  '--parameters', (Join-Path $infra 'main.bicepparam'),
  '--parameters', "linearApiKey=$linearApiKey"
)

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
