# Deeproot infrastructure

Bicep templates for every Azure resource Deeproot uses. Owner: Teammate 1 (Azure platform).

All resources live in `rg-deeproot` on the NJIT Azure for Students subscription. NJIT policy only allows `eastus2`, `canadacentral`, `mexicocentral`, `westus2` and `norwayeast`.

| Resource | Name | Tier | Region |
| --- | --- | --- | --- |
| Google Gemini (not Azure) | `gemini-3.5-flash` through the Gemini API; the default model | Google AI Studio free tier, rate limited per model | — |
| Azure OpenAI | `deeproot-aoai-ya332`, deployment `chat` (gpt-4.1-mini, 50K TPM); answers when Gemini is rate limited or down | S0, pay per token, nothing when unused | East US 2 |
| Speech | `deeproot-speech-ya332` | F0 (free, 5 audio hours/month) | East US 2 |
| AI Search | `deeproot-search-ya332`, index `sources` | Free | West US 2 |
| Cosmos DB | `deeproot-cosmos-ya332`, database `deeproot`: `sources` and `briefs` (partition key `/accountId`), `reports` and `accounts` (partition key `/id`) | Free tier, capped at 1000 RU/s | East US 2 |
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
npm run seed:azure -w api                        # accounts and sources into Cosmos DB and AI Search; safe to rerun
npm run verify:azure -w api -- path\to\meeting.wav   # verification record; the WAV is optional
npm run smoke:generate -w api                    # one plain and one structured model call
```

The setting names are listed in `api/.env.example`. Teammates without Azure access work against the stub adapters and don't need these values.

## Model provider

`MODEL_PROVIDER` chooses the model: `gemini` (deployed default), `azure` (fallback) or `stub` (offline; used when the setting is missing). `MODEL_FALLBACK=azure` sends a request to Azure OpenAI when Gemini is rate limited, overloaded or unreachable; the result's `provider` field shows which one answered. Change the deployed default with `modelProvider` in `main.bicepparam`. Test the configured model from `api/` with `npm run smoke:generate`.

## Gemini and Linear keys

These keys come from outside Azure, so the templates can't read them. The app-settings resource replaces every setting on each deploy; `deploy.ps1` carries existing `GEMINI_API_KEY` and `LINEAR_API_KEY` values forward. To set or change one:

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
