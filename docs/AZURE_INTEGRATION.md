# Azure integration: what plugs into the backend

The backend is written against six interfaces. Implement them, pass them to `createBackend`, and call one method per Azure Function. No backend code needs to change.

```ts
import { createBackend, type BackendAdapters } from "@deeproot/api";

const backend = createBackend(
  { accounts, sources, analyses, reports, model, transcribeAudio } satisfies BackendAdapters,
  { linear, appBaseUrl }, // see "Linear settings" below
);
// In each Function: const { status, body } = await backend.analyze({ user, body: await req.json() });
```

## Adapters

| Interface | Defined in | Method | Return | On failure (throw) |
| --- | --- | --- | --- | --- |
| `AccountDirectory` | [access.ts](../api/src/access.ts) | `getAccount(accountId)` | `Account \| null` | generic 500 |
| `SourceSearch` | [store/sources.ts](../api/src/store/sources.ts) | `search({ accountId, userId, query, top })` | `SourceRecord[]` | 503 INTEGRATION_UNAVAILABLE, model not called |
| `SourceWriter` | [store/sources.ts](../api/src/store/sources.ts) | `save(source)` | `void` | 503 INTEGRATION_UNAVAILABLE |
| `AnalysisStore` | [store/analyses.ts](../api/src/store/analyses.ts) | `save(analysis)`, `latest(accountId, userId)` | `void`, `AgentAnalysis \| null` | save: logged, analysis still returned. latest: 503 |
| `ReportStore` | [store/reports.ts](../api/src/store/reports.ts) | `get(reportId)`, `save(report)`, `reserveLinearCreation(reportId, creation)`, `completeLinearCreation(reportId, issue)` | `StoredReport \| null`, `void` | generic 500 |
| `ChatModel` | [agent/model.ts](../api/src/agent/model.ts) | `complete({ system, user, maxTokens })` | reply text | 503 INTEGRATION_UNAVAILABLE |
| `TranscribeAudio` | [ingest/meeting.ts](../api/src/ingest/meeting.ts) | `(audio: Uint8Array)` | `TranscriptSegment[]` | 502 TRANSCRIPTION_FAILED; prepared transcript only on explicit demo fallback |

The in-memory versions (`InMemorySourceSearch`, `InMemoryAnalysisStore`, `InMemoryReportStore`, `InMemoryAccountDirectory`) are reference implementations. Copy their behavior.

### Expectations per adapter

- **SourceSearch** must filter on `accountId` **and** `allowedUserIds` contains `userId` *inside the query*. Return whole records, newest first for an empty `query`, and at most `top`. If a filter is missed, the agent refuses to run (500) instead of analyzing the leak.
- **SourceWriter** stores each record exactly as given, including `allowedUserIds`, replacing any record with the same `id`. If you use AI Search, update the index too. Seed with `SEED_ACCOUNTS` and `buildSeedSources()`.
- **AnalysisStore.latest** is scoped to `createdBy`, not just the account.
- **ChatModel**: `system` is the system instruction and `user` is one user message. Use temperature 0 and JSON output mode. Return the text unchanged and do your retries inside. Never log `user`, because it contains account records.
- **TranscribeAudio** receives a validated WAV. Return ordered segments; `speaker` is the raw diarization label (`"1"`, `"Guest-1"`). Leave `speaker` out if there is no diarization.
  The HTTP upload path keeps those speaker labels by default. Speaker-name mappings are explicit backend configuration. Prepared fallback requires multipart `allowPreparedFallback=true`; normal browser uploads never request it.

### Security rules the backend relies on

- `user` comes from `requestUser(header, process.env.DEMO_USER_ID)` in [functions/principal.ts](../api/src/functions/principal.ts). With the `DEMO_USER_ID` app setting (demo mode), every request acts as that user with no sign-in; leave it empty to require Static Web Apps sign-in. Never take the user from the request body. Account access checks run either way.
- Error bodies never name an account or source. Detailed errors go to logs only.
- After seeding, run `checkSourceSearchIsolation(yourSearch)` (exported from `@deeproot/api`) against the real store. It throws on any filter bug.

## Routes

| Route | Method | Input |
| --- | --- | --- |
| `POST /api/meetings/transcribe` | `transcribe` | `{ user, accountId, audio: Buffer, fileName }` from multipart |
| `POST /api/meetings` | `saveMeeting` | `{ user, body }`, body is `SaveMeetingRequest` |
| `POST /api/ingest/emails` | `ingestEmails` | `{ user, body }`, body is `{ emails: [...] }` |
| `POST /api/ingest/apps/{appId}` | `ingestAppRecords` | `{ user, appId, body }`, body is `{ records: [...] }` |
| `POST /api/agent/analyze` | `analyze` | `{ user, body }`, body is `AnalyzeRequest` |
| `GET /api/accounts/{id}/analysis` | `latestAnalysis` | `{ user, accountId }` |

Each method returns `{ status, body }`; send both as-is. Call `createBackend` once per process to reuse brief/sync coalescing. Linear coordination uses durable report reservations and conditional updates, rather than a process-local map.

`POST /api/reports` already saves the reviewed meeting as a source, keyed by the report ID. Use `POST /api/meetings` only for meetings that don't get a report. Calling both for one meeting stores it twice.

## Error codes

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | BAD_REQUEST | Invalid input; the message is safe to show |
| 401 | UNAUTHENTICATED | No signed-in user |
| 404 | NOT_FOUND | Missing **or** not permitted (deliberately the same) |
| 500 | (generic) | Unexpected error, including an isolation violation. Check the logs |
| 502 | INVALID_MODEL_OUTPUT / TRANSCRIPTION_FAILED | The model reply was unreadable twice / Speech failed with no fallback |
| 503 | INTEGRATION_UNAVAILABLE | Search, storage, or model adapter threw |

Citations that fail validation are not errors. They are removed and counted in `analysis.validation`.

## Linear settings

Set these as app settings (never commit the key) and pass them to `createBackend`:

```ts
const linear = process.env.LINEAR_API_KEY && process.env.LINEAR_TEAM_ID
  ? { apiKey: process.env.LINEAR_API_KEY, teamId: process.env.LINEAR_TEAM_ID, teamKey: process.env.LINEAR_TEAM_KEY }
  : null;
const appBaseUrl = process.env.APP_BASE_URL ?? "";
```

With `linear` null and no pending attempt, Create in Linear returns 503 with `error.fallbackUrl`. A pending attempt never gets a manual-create link: restore its original configuration and reconcile it.

## Report generation, briefs, and durable Linear attempts

`createBackend` defaults to `createReportGenerator(model)`. Supply `sampleReportGenerator` explicitly only in tests or fixture workflows. The live model sees the complete reviewed transcript and permitted account records; the report handler validates citation quotes and removes unsupported owners/dates before saving.

Brief responses now include optional `sources` alongside `emails`, so internal-tool and meeting citations can be opened. Cache entries have a source fingerprint and a five-minute lifetime; one backend instance coalesces matching in-flight requests. `InMemoryAnalysisStore` keeps only the latest analysis per account/user. Old entries without a fingerprint are regenerated.

`ReportStore.reserveLinearCreation` must atomically select the first accepted UUID v4, team ID, reviewed draft, and rendered description. Cosmos uses an ETag-conditioned replacement and retries 412 conflicts. An existing reservation is immutable. `completeLinearCreation` patches the issue result without replacing the report or its cited-source snapshot. Reservations remain private; the API exposes only a pending/created status and the accepted ticket draft.

Linear receives the saved UUID in `IssueCreateInput.id`. Concurrent conflicts, restarts, timeouts, and failed local persistence are reconciled by querying that identity, including archived issues. This design depends on Linear enforcing unique UUIDs; use the explicit provider verification script before release. A pending reservation is never discarded automatically. The UI freezes the draft and offers reconciliation, rather than a second manual creation.

Report links use `/?report=<id>`; `/reports/<id>` remains supported for older issues. New fields are additive and existing reports remain readable. Existing reports need no bulk migration. Latest analyses use the existing briefs container; the optional integration workflow adds an account-partitioned integrations container.


## Evidence and investigation contracts

Configured `SourceSearch` adapters must implement authoritative `get(accountId, sourceId)` as well as filtered search. Azure Search results are rehydrated from Cosmos and rechecked against current ACL/classification; revoked stored report evidence fails closed for report reads, Ask, Verify and Linear creation. `SourceWriter.remove` supports full-snapshot connector deletions and revocations. Source versions distinguish historical report evidence from current source bodies. `GET /api/accounts/{id}/sources/{sourceId}` authorizes recovery reads, optionally using `version` and `reportId` for historical snapshots.

Ask/Verify use scope/planning before retrieval, up to two rounds/two queries per round/20 distinct records, an optional synthesis phase, and a separate factual evidence check. Model requests and retry/fallback calls carry the shared 40-second abort signal. History is conversational context, never evidence or tool authority. Verify must cover the whole original statement and exposes optional claim results; unsupported rewrites are suppressed. Completed steps contain searches/checks, not private reasoning.

Report generation excludes earlier meetings, requires current reviewed-transcript citations for new decisions/commitments, and verifies factual narrative/proposals. `previousReportId` creates a separate authorized revision. `ticketStatus=none` blocks Linear creation. Trusted connector policies and HTTP settings are read from server configuration, not request payloads. ACL/policy metadata stays private.
