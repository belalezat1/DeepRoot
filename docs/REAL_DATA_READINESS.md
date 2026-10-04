# From a credible demo to a real account workspace

Deeproot's reasoning pipeline can run against real account delivery records today. The biggest remaining work is obtaining those records, keeping their permissions current, and operating the system with real identities. Local changes must be deployed before they appear at the public demo URL.

## What is real, and what is still a fixture?

| Flow | Current live implementation | Smallest step to use a real instance |
|---|---|---|
| Account brief / analysis | Configured Gemini or Azure OpenAI reads permitted retrieved sources; citations, dates and owners are validated. Five-minute cache detects source edits. Refresh brief regenerates analysis. | Import sanitized account emails and status exports through existing endpoints. Latest analyses use memory locally and the existing Cosmos briefs container when configured. |
| Meeting transcription | MP4 uploads extract audio in the browser; the Azure Speech adapter transcribes normalized PCM audio. Normal uploads fail explicitly on outages and keep unidentified speaker labels. | Supply Speech settings and an MP4 with a supported audio track, or import/paste a real text transcript without Speech. Reports accept up to 20,000 characters. |
| Meeting report | Configured model receives the complete reviewed transcript and permitted account evidence. The live backend no longer selects the sample report. | Change a concrete commitment in the transcript and regenerate. Verify the changed commitment and its citation, rather than comparing only prose. |
| Ask | Configured model, semantic scope screening, bounded evidence investigation and a separate factual verification phase. Explicit role/privacy refusals; history cannot supply citations or permissions. | Use the real model settings; test paraphrased follow-ups and refusal cases with the provider check below. |
| Verify | Configured model decomposes up to eight claims, investigates permitted evidence and verifies each verdict. Original-statement coverage is required; unsupported rewrites are suppressed. | Try a real client promise containing an incorrect status or date and inspect its cited evidence. |
| Linear | Real GraphQL integration, human-reviewed draft and durable UUID reservation/reconciliation in configured Cosmos storage. | Set the key/team and verify provider uniqueness behavior before relying on deployment-wide duplicate protection. |
| Mail / internal tools | Editable fictional sample apps have CRUD/export APIs and authenticated HTTP sync with status receipts. There is no real mailbox or ADP tenant connection. Live Inbox shows only API emails; mock Inbox adds fictional filler. | Start with an export, using trusted routing configuration. A scheduled sync comes after credentials and upstream permissions are settled. |
| Accounts and access | Backend authorizes account access and filters source reads by account and user. Public demo impersonates `presenter` by configuration. | Remove `DEMO_USER_ID`, require sign-in, and populate approved accounts/access lists. Principal matching currently uses SWA `userDetails`; immutable identity/group mapping needs additional work. |

Mock mode has prepared answers and a fixed Northstar report; it rejects custom-transcript generation. Its header and meeting instructions identify that behavior. Real model behavior requires live mode and configured credentials. No real provider credentials were available during this local implementation pass.

## Quick path: export first, sync second

1. Create the real account in the configured account directory with its approved user list. Avoid using the public presenter identity for real records.
2. Configure trusted mappings in Functions settings. These replace fixture routing; they are never accepted from an import request:

   ```dotenv
   EMAIL_ROUTING_JSON={"client@accounts.example.com":"client-id"}
   CONNECTOR_ACCOUNT_MAPS_JSON={"impl-tracker":{"REAL_CUSTOMER_CODE":"client-id"},"payroll-config":{"REAL_CUSTOMER_CODE":"client-id"}}
   ```

   An explicitly empty object disables routing. Once internal-app configuration is provided, unlisted connectors have no account mappings. Invalid configuration fails startup. Connector field mappings remain in `api/src/ingest/connectors/`; a tool with a different export schema needs its own mapping.
3. Import an email export with `POST /api/ingest/emails`, body `{"emails":[...]}`. Each email needs `messageId`, `from`, `to`/`cc`, `sentAt`, and `text` or `html`. It must be addressed to exactly one configured account mailbox. Arbitrary historical emails lacking that routing cannot be imported without an explicit trusted adapter.
4. Import status exports with `POST /api/ingest/apps/impl-tracker` or `/api/ingest/apps/payroll-config`, body `{"records":[...]}` matching the connector's schema. Stable source IDs make repeated imports replace existing records. Check both `ingested` and `rejected`; a successful request can contain rejected rows.
5. Open `/?account=client-id`, refresh the brief, import a reviewed transcript, and inspect citations. Source updates invalidate brief caches on the next read.

These endpoints are already present; this pass adds server settings so account routing does not require changing ingestion logic. A real Graph mailbox sync is a separate adapter with credentials, pagination, deletion handling and incremental state. Microsoft Graph supports [per-folder message delta queries](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0), which can feed the existing normalization path. This is an integration project, not a connected mailbox today.

## What to borrow from Glean

Glean describes controls at identity, source permissions, sensitive content, topic restrictions, runtime threats and action execution, backed by auditing. It also publishes enterprise security/compliance information. See its [security overview](https://www.glean.com/platform/security) and [permissions-aware search FAQ](https://docs.glean.com/administration/search/faq). Those are Glean's published capabilities, not certifications Deeproot inherits by using Azure or similar prompts.

| Control | Deeproot now | Remaining work before real sensitive enterprise data |
|---|---|---|
| Identity before AI | Server principal/account checks; public demo has a shared configured identity. | Real SSO identities, immutable IDs and managed account membership; remove presenter impersonation. [SWA auth documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization). |
| Permissions before retrieval | Account/user filters in Search, with server isolation checks. Authoritative reads recheck current source access and classification before returning Search hits, cached analyses or report snapshots. | Trusted connector settings can map upstream document ACLs/classification and fail closed for missing or unmapped permissions. Real group membership synchronization, schedules and operational revocation monitoring remain necessary. Account-level connectors are explicitly labelled. [Azure Search security filters](https://learn.microsoft.com/en-us/azure/search/search-security-trimming-for-azure-search). |
| Sensitive payroll exclusion | This role refuses individual pay/tax/bank queries; conservative screening rejects recognizable personal payroll imports and excludes recognizable sensitive sources before AI/browser responses. | Upstream classification and exclusion of employee payroll records. The keyword screen can miss paraphrases and produce false positives; it is not an authorization boundary or complete DLP system. |
| Topic restrictions | Server handles obvious role violations; a separate model scope phase handles semantic variants before retrieval; refusal text is fixed and does not confirm a person's records exist. Model output is also screened. | Broader adversarial evaluations with the actual model and provider versions, including history and source injection. |
| Reviewed actions | Linear creation requires a reviewed ticket, account authorization, frozen reservation and retry reconciliation. | Production secret management, action audit records and provider checks. No payroll write tools exist. |
| Audit / retention / assurance | Application logs and tests; bounded local chat history is not persisted or sent to another account. | Durable access/action audit logs, retention/deletion policy, provider data-handling agreements, incident procedures and independent audits. No SOC 2, ISO, HIPAA or GDPR compliance claim is made for Deeproot. |

The policy is intentionally simple: **the account-team role cannot disclose individual payroll details, even if the requester says they are HR**. It can discuss implementation dependencies, affected counts, ownership and delivery dates. Sensitive employee records should never be routed into this workspace in the first place. The real source permission model must enforce access independently of any model response.

## Verify behavior with the configured model

For the isolated model-only rehearsal, configure model settings in ignored `api/.env`, then from the repository root:

```sh
npm run configure:local -w api
npm run verify:local -w api
```

The check uses fictional records with the real model: a grounded answer, semantic coding/privacy refusals, a contradicted client promise, changed-transcript reports, and a sample tracker edit imported over HTTP that changes a cited ownership answer. It does not write to the deployed workspace by default. `--create-test-issue` additionally performs the documented disposable Linear/Cosmos identity check; see `infra/README.md` before invoking that write check.

Local regression tests cover recognizable restrictions before retrieval/model calls, history limits and spoofed roles, private-source exclusion, sensitive imports/reports, claim report context, transcription failures, conversation continuity and live inbox contents. Passing scripted tests does not certify the live model or a production compliance program.

## UI wins included

- A Gather → Understand → Ground → Act strip reflects actual transcript/report/issue state.
- Brief counters come from returned findings and citations, with live/mock labels and source-kind labels.
- Ask uses a conversation log, visible refusal states, source buttons, typing feedback and a keyboard shortcut.
- Text transcript import, refresh brief and clearer Speech failures make the real workflow easier to rehearse.
- Forest gradients, gold accents and a waveform emblem add polish while respecting the motion toggle and reduced-motion settings.

This pass includes connector status/sample tools, changed-source highlights, completed investigation steps, claim verdict cards, report revision comparison and copying reviewed follow-up/verified wording. Scheduled production connectors and a permission-filtered account picker remain future work. Formal compliance requires its own operational and assurance program.
