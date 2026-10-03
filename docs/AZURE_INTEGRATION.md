# Azure integration: what plugs into the backend

The backend (ingestion and agent) is written against five interfaces. Implement them, pass them to `createBackend`, and call one method per Azure Function. No backend code needs to change.

```ts
import { createBackend, type BackendAdapters } from "@deeproot/api";

const backend = createBackend({ accounts, sources, analyses, model, transcribeAudio } satisfies BackendAdapters);
// In each Function: const { status, body } = await backend.analyze({ user, body: await req.json() });
```

## Adapters

| Interface | Defined in | Method | Return | On failure (throw) |
| --- | --- | --- | --- | --- |
| `AccountDirectory` | [access.ts](../api/src/access.ts) | `getAccount(accountId)` | `Account \| null` | generic 500 |
| `SourceSearch` | [store/sources.ts](../api/src/store/sources.ts) | `search({ accountId, userId, query, top })` | `SourceRecord[]` | 503 INTEGRATION_UNAVAILABLE, model not called |
| `SourceWriter` | [store/sources.ts](../api/src/store/sources.ts) | `upsert(records)` | `void` | 503 INTEGRATION_UNAVAILABLE |
| `AnalysisStore` | [store/analyses.ts](../api/src/store/analyses.ts) | `save(analysis)`, `latest(accountId, userId)` | `void`, `AgentAnalysis \| null` | save: logged, analysis still returned. latest: 503 |
| `ChatModel` | [agent/model.ts](../api/src/agent/model.ts) | `complete({ system, user, maxTokens })` | reply text | 503 INTEGRATION_UNAVAILABLE |
| `TranscribeAudio` | [ingest/meeting.ts](../api/src/ingest/meeting.ts) | `(audio: Uint8Array)` | `TranscriptSegment[]` | prepared transcript, else 502 TRANSCRIPTION_FAILED |

The in-memory versions (`InMemorySourceStore`, `InMemoryAnalysisStore`, `InMemoryAccountDirectory`) are reference implementations. Copy their behavior.

### Expectations per adapter

- **SourceSearch** must filter on `accountId` **and** `allowedUserIds` contains `userId` *inside the query*. Return whole records, newest first for an empty `query`, and at most `top`. If a filter is missed, the agent refuses to run (500) instead of analyzing the leak.
- **SourceWriter** stores records exactly as given, including `allowedUserIds`, upserting by `id`. Seed with `SEED_ACCOUNTS` and `buildSeedSources()`.
- **AnalysisStore.latest** is scoped to `createdBy`, not just the account.
- **ChatModel**: `system` is the system instruction and `user` is one user message. Use temperature 0 and JSON output mode. Return the text unchanged and do your retries inside. Never log `user`, because it contains account records.
- **TranscribeAudio** receives a validated WAV. Return ordered segments; `speaker` is the raw diarization label (`"1"`, `"Guest-1"`). Leave `speaker` out if there is no diarization.

### Security rules the backend relies on

- `user` is `{ userId }` from the Static Web Apps principal header, or `null` when signed out. Never take it from the request body.
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

Each method returns `{ status, body }`; send both as-is. `POST /api/reports/{id}/linear` is wired separately (`handleCreateLinearIssue`).

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
