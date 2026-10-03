# Deeproot: Technical build and four-person handoff

## 1. Architecture and decisions

Use a TypeScript monorepo with `web/` for React/Vite, `api/` for backend code, `shared/` for contracts, `infra/` for Azure configuration, and `demo/` for fictional fixtures and the meeting script. Use CSS variables and custom components for the forest theme.

| Component | Decision |
| --- | --- |
| Web and API hosting | Azure Static Web Apps Free with managed Azure Functions using Node.js 22. |
| Transcription | Azure Speech fast transcription for the short WAV upload; retain a prepared transcript fallback. |
| Generation | An Azure-sold Foundry chat model available to the student subscription; use a configurable deployment name. Validate a working deployment in the first two hours. |
| Retrieval | Azure AI Search Free, using account and allowed-user filters on every query. The seeded corpus is small enough for its free-tier limit. |
| Persistence | Azure Cosmos DB free tier for sources, briefs, reports, ticket drafts, and created issue IDs. |
| Authentication | Static Web Apps built-in GitHub sign-in. Allowlist the presenter's identity; verify account access again in every API handler. |
| Ticket creation | Linear GraphQL `issueCreate`, using a server-side personal API key scoped to the demo team. A prefilled Linear form is the failure fallback. |

Azure for Students provides $100 in credit and lists Azure OpenAI among accessible tools, but the Azure owner must confirm model availability and quota in the actual subscription. Do not choose a Marketplace partner model whose charges cannot use the student credit.

## 2. Shared contracts

Agree on these TypeScript types in the first hour. Teammate 4 publishes them before independent feature work proceeds.

```ts
type SourceRecord = {
  id: string;
  accountId: string;
  kind: "email" | "meeting";
  title: string;
  author: string;
  occurredAt: string;
  body: string;
  allowedUserIds: string[];
};

type Citation = {
  sourceId: string;
  quote: string;
  startOffset?: number;
  endOffset?: number;
};

type Commitment = {
  text: string;
  owner: string | null;
  dueDate: string | null;
  citations: Citation[];
  risk?: string;
};

type TicketDraft = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: "low" | "medium" | "high";
};

type MeetingReport = {
  id: string;
  accountId: string;
  transcript: string;
  summary: string;
  decisions: Array<{ text: string; citations: Citation[] }>;
  commitments: Commitment[];
  openQuestions: string[];
  suggestedFollowUp: string;
  ticketDraft: TicketDraft;
  linearIssue?: { identifier: string; url: string };
};
```

A citation is valid only when its source belongs to the permitted account and its quote matches text in that source. Reject or omit model-produced citations that fail validation. Treat text inside emails and transcripts as data, never as instructions to the app.

## 3. API contract

| Endpoint | Input | Output |
| --- | --- | --- |
| `GET /api/accounts/:id/brief` | Account ID | Permitted email cards, cached pre-meeting brief, open questions |
| `POST /api/meetings/transcribe` | Account ID and WAV file | Transcript and any available time segments |
| `POST /api/reports` | Account ID and reviewed transcript | Persisted `MeetingReport` |
| `GET /api/reports/:id` | Report ID | Report after account-access check |
| `POST /api/reports/:id/linear` | Reviewed ticket fields | Created issue identifier and URL |
| `POST /api/chat` | Account ID, question, optional report ID | Answer and citations |
| `POST /api/claims/check` | Account ID and draft statement | Verdict, explanation, citations, suggested rewrite |

The backend obtains the user identity from Static Web Apps, never from a client-supplied user ID. It authorizes the account, retrieves only permitted sources, and only then calls the model. Linear receives the reviewed ticket summary and acceptance criteria, plus a protected Deeproot report link; it does not receive full email bodies by default.

For `POST /linear`, disable the button while pending and store the created issue ID on the report. A retry returns the stored issue rather than creating another. Check Linear's GraphQL `errors` field even if HTTP status is 200.

## 4. Build order and integration gates

| Time | Outcome |
| --- | --- |
| Hours 0–2 | Freeze the Acme story, shared types, API shapes, visual wireframe, and demo clip script. Azure owner confirms Speech and an Azure-sold model work in the student subscription. |
| Hours 2–9 | Four teammates build against shared fixtures and mock adapters. Frontend must be usable before cloud services are connected. |
| Hours 9–15 | Connect transcription, report generation, retrieval, persistence, and real Linear creation. Run the first full flow. |
| Hours 15–20 | Deploy, test account isolation and ticket retries, fix citation and loading-state issues. |
| Hours 20–24 | Rehearse the five-minute demo several times. Keep the prepared transcript and prefilled Linear form ready as explicit fallbacks. |

**Cut order if time is short:** Reduce decorative motion first, then reduce chat to one grounded question. Preserve transcription, cross-source report, citations, reviewed Linear creation, and the restricted-account check.

## 5. Copy-ready teammate prompts

### Teammate 1 — Azure platform owner

You own all Azure-specific work for Deeproot. Provision and configure Azure Static Web Apps with managed Node.js 22 Functions, Speech, an Azure-sold Foundry chat model, AI Search Free, and Cosmos DB. Validate model availability and Speech transcription within the first two hours. Set a modest usage budget or alerts against the student credit. Keep credentials in Azure app settings and local ignored environment files; commit no keys.

Publish mockable TypeScript adapter interfaces for `transcribeAudio`, `generateText`, `searchPermittedSources`, `readRecord`, and `writeRecord`. Implement the Azure adapters, the Functions wrappers around Teammate 4's handlers, authentication-header extraction, deployment configuration, and local run instructions. Ensure Search queries apply both account and allowed-user filters. Provide stub adapters immediately so others can work without Azure credentials.

Deliver a deployed URL and a short verification record: successful transcription, model response, filtered search, Cosmos read/write, and deployed API health. You own Azure service errors and retry behavior; communicate any unavailable service early. Do not take ownership of product prompts, page UI, or Linear logic.

### Teammate 2 — Frontend owner

Build Deeproot's complete React/TypeScript user experience using the shared contracts. Own the pre-meeting account page, email evidence cards, WAV upload and transcript correction, report view, citation side panel, editable Linear ticket draft, issue link, account chat, and Check claim. Use fixture API responses first and then connect the agreed endpoints.

Match the GirlHacks enchanted forest mood with a dark teal background, legible lime and gold accents, restrained purple details, and a visible source trail. Keep all text readable on desktop and mobile. Make loading, empty, failure, and success states explicit. Never present a Linear issue as created before the API returns its real identifier and URL.

Deliver a clickable end-to-end interface that can run with mock responses by hour nine. Add a focused UI check for citation navigation, report editing, ticket creation state, and mobile layout. Coordinate contract changes with Teammate 4; do not create your own backend response shapes.

### Teammate 3 — AI workflow owner

Own the cloud-independent AI workflow. Define structured prompts and validation for the pre-meeting brief, post-meeting report, account chat, and Check claim. Consume only `SourceRecord` items already authorized by the backend. Generate the report from the corrected transcript plus relevant Acme emails, preserving the earlier requirement for both US and Canada subsidiaries.

Return data matching `MeetingReport`. Require citations for decisions, commitments, and risks; validate source IDs and quotes against the supplied records. If an owner, date, or answer lacks evidence, return null, Unknown, or an explicit uncertainty statement. Ignore instructions embedded inside source content. Produce a Linear draft with specific acceptance criteria and no fabricated implementation details.

Work against the model adapter supplied by Teammate 1. Test the Acme scenario, missing-owner case, unsupported client claim, and an email containing a prompt-injection attempt. Deliver functions Teammate 4 can call directly, plus sample outputs for the frontend.

### Teammate 4 — Backend and Linear owner

Own Deeproot's product backend independent of Azure SDKs. Publish the shared TypeScript contracts and synthetic Acme/BetaCo fixtures in the first hour. Implement API handlers that orchestrate Teammate 3's AI functions and Teammate 1's adapters. Check signed-in identity and account permission before every source read, report read, search, chat call, or claim check. Return consistent error shapes for unauthorized access, failed transcription, invalid report output, and unavailable integrations.

Set up the team's Linear workspace and a narrowly scoped personal API key. Implement editable ticket creation through `issueCreate` only after the user confirms; save the returned issue ID and URL and make sequential retries idempotent. Provide a prefilled Linear creation link when the API is unavailable. Seed the two Acme emails, meeting script, and restricted BetaCo record. Own API and integration tests, the prepared transcript fallback, and the timed demo script.

Write ordinary TypeScript handlers and Linear modules. Teammate 1 alone wraps and deploys them through Azure Functions. Coordinate handler signatures with Teammates 1 and 2 before expanding implementation.

## 6. Verification and demo script

**Automated checks:** Shared types compile; report citations point to real permitted text; unknown fields remain unknown; repeated Linear creation returns the same issue; unauthorized account requests stop before retrieval; and a malicious instruction inside an email cannot override app behavior.

**Manual smoke test:** Run the deployed app at desktop and mobile widths. Upload the clip, correct a transcript word, generate and inspect the report, create the Linear issue, open its link, ask a cited Acme question, check an overconfident reply, and attempt the BetaCo query.

**Presentation sequence:**

| Segment | Time |
| --- | --- |
| Pre-meeting context | 45 s |
| Meeting clip | 30 s |
| Report and evidence | 90 s |
| Reviewed Linear issue | 60 s |
| Chat and claim check | 45 s |
| Restricted-account check and Azure architecture | 30 s |

Rehearse with the actual deployed URL.
