// Deeproot services inside rg-deeproot. Every service uses a free tier except Azure OpenAI,
// which bills per token and serves only as the fallback when MODEL_PROVIDER is 'azure'.
param location string
param searchLocation string
param suffix string
param tags object
param chatModelName string
param chatModelVersion string
param chatDeploymentName string
param chatCapacity int
param modelProvider string
param modelFallback string
param geminiModel string
param geminiThinkingLevel string
param geminiTimeoutMs int

@secure()
param geminiApiKey string

@secure()
param linearApiKey string

param linearTeamId string
param linearTeamKey string
param demoUserId string

var openAiApiVersion = '2024-10-21'
var searchIndexName = 'sources'
var cosmosDatabaseName = 'deeproot'
// Partition keys match how the API reads each container: sources and briefs by account,
// reports and accounts by their own ID (ReportStore.get and AccountDirectory.getAccount take only an ID).
var cosmosContainers = [
  { name: 'sources', partitionKey: '/accountId' }
  { name: 'briefs', partitionKey: '/accountId' }
  { name: 'reports', partitionKey: '/id' }
  { name: 'accounts', partitionKey: '/id' }
]

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'deeproot-aoai-${suffix}'
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  tags: tags
  properties: {
    customSubDomainName: 'deeproot-aoai-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: chatDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: chatCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModelName
      version: chatModelVersion
    }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// F0 includes 5 audio hours per month and supports fast transcription.
resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'deeproot-speech-${suffix}'
  location: location
  kind: 'SpeechServices'
  sku: {
    name: 'F0'
  }
  tags: tags
  properties: {
    customSubDomainName: 'deeproot-speech-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

// One free Search service is allowed per subscription. The index itself is created by deploy.ps1.
resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: 'deeproot-search-${suffix}'
  location: searchLocation
  sku: {
    name: 'free'
  }
  tags: tags
}

// One free-tier Cosmos account is allowed per subscription. The throughput cap keeps it inside the free 1000 RU/s.
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'deeproot-cosmos-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    enableAutomaticFailover: true
    capacity: {
      totalThroughputLimit: 1000
    }
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    minimalTlsVersion: 'Tls12'
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    options: {
      throughput: 1000
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for container in cosmosContainers: {
    parent: cosmosDatabase
    name: container.name
    properties: {
      resource: {
        id: container.name
        partitionKey: {
          paths: [
            container.partitionKey
          ]
          kind: 'Hash'
        }
      }
    }
  }
]

// Code is deployed separately with a deployment token, so no repository is linked here.
resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: 'deeproot-web-${suffix}'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  tags: tags
  properties: {}
}

// This resource replaces all app settings on every deploy; deploy.ps1 carries the Gemini and Linear values forward.
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: union(
    {
      MODEL_PROVIDER: modelProvider
      MODEL_FALLBACK: modelFallback
      GEMINI_MODEL: geminiModel
      GEMINI_THINKING_LEVEL: geminiThinkingLevel
      GEMINI_TIMEOUT_MS: string(geminiTimeoutMs)
      AZURE_OPENAI_ENDPOINT: openAi.properties.endpoint
      AZURE_OPENAI_API_KEY: openAi.listKeys().key1
      AZURE_OPENAI_DEPLOYMENT: chatDeployment.name
      AZURE_OPENAI_API_VERSION: openAiApiVersion
      AZURE_SPEECH_REGION: location
      AZURE_SPEECH_KEY: speech.listKeys().key1
      AZURE_SEARCH_ENDPOINT: 'https://${search.name}.search.windows.net'
      AZURE_SEARCH_INDEX: searchIndexName
      AZURE_SEARCH_ADMIN_KEY: search.listAdminKeys().primaryKey
      AZURE_SEARCH_QUERY_KEY: search.listQueryKeys().value[0].key
      COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
      COSMOS_KEY: cosmos.listKeys().primaryMasterKey
      COSMOS_DATABASE: cosmosDatabaseName
      APP_BASE_URL: 'https://${staticWebApp.properties.defaultHostname}'
    },
    empty(geminiApiKey) ? {} : { GEMINI_API_KEY: geminiApiKey },
    empty(linearApiKey) ? {} : { LINEAR_API_KEY: linearApiKey },
    empty(linearTeamId) ? {} : { LINEAR_TEAM_ID: linearTeamId },
    empty(linearTeamKey) ? {} : { LINEAR_TEAM_KEY: linearTeamKey },
    empty(demoUserId) ? {} : { DEMO_USER_ID: demoUserId }
  )
}

output openAiEndpoint string = openAi.properties.endpoint
output searchServiceName string = search.name
output searchEndpoint string = 'https://${search.name}.search.windows.net'
output searchIndexName string = searchIndexName
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
