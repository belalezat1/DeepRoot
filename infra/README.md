# Deeproot infrastructure

Bicep templates for every Azure resource Deeproot uses. Owner: Teammate 1 (Azure platform).

All resources live in `rg-deeproot` on the NJIT Azure for Students subscription. NJIT policy only allows `eastus2`, `canadacentral`, `mexicocentral`, `westus2` and `norwayeast`.

| Resource | Name | Tier | Region |
| --- | --- | --- | --- |
| Google Gemini (not Azure) | `gemini-3.5-flash-lite` through the Gemini API; the default model, with a 12 s limit before Azure OpenAI answers | Google AI Studio free tier, rate limited per model | — |
| Azure OpenAI | `deeproot-aoai-ya332`, deployment `chat` (gpt-4.1-mini, 50K TPM); answers when Gemini is rate limited or down | S0, pay per token, nothing when unused | East US 2 |
| Speech | `deeproot-speech-ya332` | F0 (free, 5 audio hours/month) | East US 2 |
| AI Search | `deeproot-search-ya332`, index `sources` | Free | West US 2 |
| Cosmos DB | `deeproot-cosmos-ya332`, database `deeproot`: `sources`, `briefs` and `integrations` (partition key `/accountId`), `reports` and `accounts` (partition key `/id`) | Free tier, capped at 1000 RU/s | East US 2 |
| Static Web Apps | `deeproot-web-ya332` | Free | East US 2 |
| Budget | `deeproot-budget`, $25/month, emails at 50%, 90% and forecast 100% | — | Subscription |

Search is in West US 2 because East US 2 had no free Search capacity on 2026-10-03.

## Files

| File | Purpose |
| --- | --- |
| `main.bicep` | Subscription scope: resource group, budget, and the module below |
| `resources.bicep` | Every service, plus the web app's settings (keys are read from the resources, never stored in git) |
| `main.bicepparam` | Values for this subscription |
| `search-index.json` | Search index schema, mirroring `SourceRecord` |
| `deploy.ps1` | Deploys the templates, then creates or updates the Search index |
| `write-local-settings.ps1` | Copies the deployed app settings into ignored `api/.env` and `api/local.settings.json`, keeping other lines in `api/.env` |

## Usage

Requires the Azure CLI signed in with `az login` (NJIT account) on the Azure for Students subscription.

```powershell
.\infra\deploy.ps1 -WhatIf      # preview changes
.\infra\deploy.ps1              # apply; safe to rerun
.\infra\write-local-settings.ps1
```

Then load the demo data and check every service against the live resources (all from the repo root):

```powershell
npm run seed -w api                              # accounts and sources into Cosmos DB and AI Search; safe to rerun
npm run verify:azure -w api -- path\to\meeting.wav   # verification record; the WAV is optional
npm run smoke:generate -w api                    # one plain and one structured model call
```

## API (Azure Functions)

`api/src/functions/app.ts` wraps the backend handlers as HTTP functions (v4 programming model, Node 22). The signed-in user comes only from Static Web Apps' `x-ms-client-principal` header (`userDetails`), which Static Web Apps sets itself and strips from browser requests. `GET /api/health` reports which backend each service uses.

**Demo mode (deployed default):** `DEMO_USER_ID=presenter` makes every request act as `presenter`, so the demo needs no sign-in. Access checks are unchanged, so the presenter still sees only Northstar, never BetaCo. Anyone with the URL acts as the presenter, which is acceptable only because all data is fictional. To require sign-in, set `demoUserId = ''` in `main.bicepparam` and redeploy.

```powershell
npm run build:functions -w api   # bundles everything into api/deploy (git-ignored)
.\infra\deploy-app.ps1           # build fresh live frontend and API, then deploy; missing frontend aborts to the Static Web App
```

Run locally by loading `api/.env` into the environment and starting the host; settings files with keys are never copied into `api/deploy`:

```powershell
Get-Content api\.env | ? { $_ -match '^([A-Z0-9_]+)=(.*)$' } | % { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2]) }
$env:FUNCTIONS_WORKER_RUNTIME = 'node'
npm run start:functions -w api   # http://localhost:7071/api/...
```

Locally, `DEMO_USER_ID=presenter` enables the fictional presenter without sign-in. With demo mode disabled, supply the local test principal header yourself; do not expose a standalone Functions host as a trusted auth gateway. `infra/staticwebapp.config.json` pins the API to Node 22.

The setting names are listed in `api/.env.example`. Teammates without Azure access work against the stub adapters and don't need these values.

## Model provider

`MODEL_PROVIDER` chooses the model: `gemini` (deployed default), `azure` (fallback) or `stub` (offline; used when the setting is missing). `MODEL_FALLBACK=azure` sends a request to Azure OpenAI when Gemini is rate limited, overloaded or unreachable; the result's `provider` field shows which one answered. Change the deployed default with `modelProvider` in `main.bicepparam`. Test the configured model from `api/` with `npm run smoke:generate`.

## Gemini and Linear keys

These keys come from outside Azure, so the templates can't read them. The app-settings resource replaces every setting on each deploy; `deploy.ps1` carries existing Gemini/Linear keys, trusted routing/policy settings, HTTP connectors and their referenced credentials forward. To set or change one:

```powershell
$env:GEMINI_API_KEY = '<key>'
.\infra\deploy.ps1
.\infra\write-local-settings.ps1
```

## Search access rules

Every query must filter on both account and user, for example:

```
accountId eq 'acme' and allowedUserIds/any(u: u eq '<signed-in user id>')
```

Document keys may only contain letters, digits, `_`, `-` and `=`.

## Verify the updated workflow before release

The root checks are `npm test`, `npm run typecheck`, and `npm run build:functions -w api`. They never create live Linear issues.

With a configured ignored `api/.env`, verify model generation and grounding without writing reports or sources:

```sh
npm run verify:workflow -w api
# Optional: include a WAV to verify Azure Speech as well
npm run verify:workflow -w api -- --audio=path/to/meeting.wav
```

To verify live UUID uniqueness and retry reconciliation as well:

```sh
npm run verify:workflow -w api -- --create-test-issue
```

The flagged check creates one labelled verification issue in the configured team, repeats creation using the same UUID, looks it up, and archives it after successful reconciliation. It also exercises conditional report coordination across two Cosmos adapters using a temporary verification report, then deletes that temporary report. It never changes existing reports. If verification fails, the script reports the verification issue UUID so it can be reconciled; it does not create another identity.

Before deploying, rehearse the mock workflow and the configured live workflow from the demo script. Verify brief evidence, a corrected transcript, the report link, the reviewed issue, and pending retry behavior. Publishing is a separate explicit step; local code changes do not update the existing demo URL.

## Isolated local rehearsal (no cloud data writes)

Hosted model settings are not automatically available locally. Supply only `MODEL_PROVIDER=gemini`, `GEMINI_API_KEY` and the deployed model name in ignored `api/.env`, or use `npm run configure:local -w api -- --from-azure` with an authenticated Azure CLI to read model settings selectively. Do not paste keys into chat.

```sh
npm run configure:local -w api
npm run start:local -w api
# Second terminal:
npm run dev:live
# Real-model verification, without Cosmos/Search/Linear/Speech:
npm run verify:local -w api
```

Requires Node 22 and Azure Functions Core Tools v4. The generated `.env.local-demo` and `local.settings.json` are ignored, restricted local files. The local runner strips inherited cloud service settings. Stub mode permits API/tool inspection but intentionally cannot generate AI answers. The verification command refuses stub mode rather than claiming provider success.

Enable sample tools only for configured fictional accounts using `ENABLE_DEMO_APPS=true`, `DEMO_APP_ACCOUNT_IDS=northstar`, a server-side `DEMO_APPS_TOKEN` of at least 16 characters, and `DEMO_APPS_BASE_URL`. The local setup generates these values. Remote URLs require HTTPS; loopback HTTP is allowed for development.

External connectors use `CONNECTOR_HTTP_JSON` with registered app IDs, server-owned export URLs and `tokenEnv` names. Exports are full snapshots, at most 200 records; sync removes previously imported rows absent from later snapshots. Account routing uses `CONNECTOR_ACCOUNT_MAPS_JSON`. `CONNECTOR_POLICIES_JSON` optionally maps upstream readers and classification; missing/unmapped permissions fail closed. See `api/.env.example`. Browser requests cannot set routing, URLs, credentials or access grants. Account-level connectors are labelled as such.

`GET /api/accounts/{id}/integrations` returns safe status and counts; `POST /api/accounts/{id}/integrations/{appId}/sync` pulls exports with eight concurrent writes maximum. Failed indexing/rejected records remain visible and preserve the previous successful sync timestamp. Concurrent syncs coalesce within a backend instance. Cosmos stores sample records and receipts in the new account-partitioned `integrations` container when enabled; deploy infrastructure separately before enabling this storage on an older deployment.

## Release boundary

`npm run build:live` prepares fresh frontend output and the Functions bundle. `.\infra\deploy-app.ps1` also builds fresh live output and refuses missing output. Publishing is explicit: pushing `main` alone does not deploy because no CI deployment workflow is configured. PowerShell/Bicep deployment commands need validation in an environment with those tools; local tests do not deploy resources.
