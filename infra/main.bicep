// Deeproot Azure infrastructure. Deploy with infra/deploy.ps1.
targetScope = 'subscription'

@description('Azure region. NJIT policy allows only eastus2, canadacentral, mexicocentral, westus2 and norwayeast.')
param location string = 'eastus2'

@description('Region for AI Search alone. Free-tier Search capacity can run out in a region; any allowed region works.')
param searchLocation string = location

param resourceGroupName string = 'rg-deeproot'

@description('Suffix that makes globally unique names unique.')
param suffix string

@description('Monthly budget in USD, checked against the $100 student credit.')
param budgetAmount int = 25

@description('First day of the budget\'s first month. Cannot change after creation.')
param budgetStartDate string = '2026-10-01'

param alertEmails array

param chatModelName string = 'gpt-4.1-mini'
param chatModelVersion string = '2025-04-14'
param chatDeploymentName string = 'chat'

@description('Thousands of tokens per minute for the chat deployment.')
param chatCapacity int = 50

@description('Linear personal API key. Leave empty to omit it from app settings.')
@secure()
param linearApiKey string = ''

var tags = {
  project: 'deeproot'
  event: 'girlhacks2026'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'deeproot-budget'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '${budgetStartDate}T00:00:00Z'
      endDate: dateTimeAdd('${budgetStartDate}T00:00:00Z', 'P1Y')
    }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: alertEmails
      }
      actual90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: alertEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: alertEmails
      }
    }
  }
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'deeproot-resources'
  params: {
    location: location
    searchLocation: searchLocation
    suffix: suffix
    tags: tags
    chatModelName: chatModelName
    chatModelVersion: chatModelVersion
    chatDeploymentName: chatDeploymentName
    chatCapacity: chatCapacity
    linearApiKey: linearApiKey
  }
}

output resourceGroupName string = rg.name
output openAiEndpoint string = resources.outputs.openAiEndpoint
output speechRegion string = location
output searchServiceName string = resources.outputs.searchServiceName
output searchEndpoint string = resources.outputs.searchEndpoint
output searchIndexName string = resources.outputs.searchIndexName
output cosmosEndpoint string = resources.outputs.cosmosEndpoint
output staticWebAppName string = resources.outputs.staticWebAppName
output staticWebAppUrl string = resources.outputs.staticWebAppUrl
