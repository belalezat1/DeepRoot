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

@description('Model provider the API uses for generation.')
@allowed([
  'gemini'
  'azure'
])
param modelProvider string = 'gemini'

@description('Provider used when the main one is rate limited or unavailable. Empty disables fallback.')
@allowed([
  ''
  'gemini'
  'azure'
])
param modelFallback string = 'azure'

@description('Free-tier limits are per model. On 2026-10-03 the Northstar analysis took 3-4 s on gemini-3.5-flash-lite, 3-10 s with failures on gemini-3.5-flash, and 9-11 s on gemini-3.1-flash-lite.')
param geminiModel string = 'gemini-3.5-flash-lite'

@description('Milliseconds to wait for Gemini before the fallback answers.')
param geminiTimeoutMs int = 12000

@description('Gemini 3 reasoning depth. Some models reject minimal, so it is not offered.')
@allowed([
  'low'
  'medium'
  'high'
])
param geminiThinkingLevel string = 'low'

@description('Google AI Studio API key. Leave empty to omit it from app settings.')
@secure()
param geminiApiKey string = ''

@description('Linear personal API key. Leave empty to omit it from app settings.')
@secure()
param linearApiKey string = ''

@description('Linear team UUID. Find it with: npm run linear:teams -w api')
param linearTeamId string = ''

@description('Linear team key shown in issue IDs, e.g. DEE.')
param linearTeamKey string = ''

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
    modelProvider: modelProvider
    modelFallback: modelFallback
    geminiModel: geminiModel
    geminiThinkingLevel: geminiThinkingLevel
    geminiTimeoutMs: geminiTimeoutMs
    geminiApiKey: geminiApiKey
    linearApiKey: linearApiKey
    linearTeamId: linearTeamId
    linearTeamKey: linearTeamKey
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
