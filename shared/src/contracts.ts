// Deeproot shared contracts. Changes go through Teammate 4; tell the team before editing.
// Types marked "from BUILD_PLAN" are the agreed shapes; the rest fill in the API contract.

// ---------- Core records (from BUILD_PLAN) ----------

// "internal_app" added: records pulled from internal tools through a declarative connector.
export type SourceKind = "email" | "meeting" | "internal_app";

/** The internal tool a record came from, so the UI can label it ("Implementation Tracker"). */
export type SourceApp = {
  id: string;
  name: string;
};

export type SourceRecord = {
  id: string;
  accountId: string;
  kind: SourceKind;
  title: string;
  author: string;
  occurredAt: string; // ISO 8601
  body: string;
  allowedUserIds: string[];
  app?: SourceApp; // set only when kind is "internal_app"
  /** Trusted connector metadata; never sent to the browser or model. */
  policy?: { classification: "delivery" | "restricted_payroll"; accessMode: "account" | "source" };
};

/** A SourceRecord as sent to the browser: the access list stays on the server. */
export type PublicSource = Omit<SourceRecord, "allowedUserIds" | "policy"> & { version?: string };

export type Citation = {
  sourceId: string;
  sourceVersion?: string;
  quote: string; // must appear verbatim in the source body
  startOffset?: number;
  endOffset?: number;
};

export type Commitment = {
  text: string;
  owner: string | null; // null renders as "Unknown"; never invented
  dueDate: string | null; // ISO date, or null when there is no evidence
  citations: Citation[];
  risk?: string;
};

export type Risk = {
  text: string;
  citations: Citation[];
};

export type TicketPriority = "low" | "medium" | "high";
export const TICKET_PRIORITIES: readonly TicketPriority[] = ["low", "medium", "high"];

export type TicketDraft = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: TicketPriority;
};

export type LinearIssueRef = {
  identifier: string; // e.g. "DEE-12"
  url: string;
};

export type MeetingReport = {
  id: string;
  accountId: string;
  transcript: string;
  summary: string;
  summaryCitations?: Citation[];
  followUpCitations?: Citation[];
  ticketCitations?: Citation[];
  decisions: Array<{ text: string; citations: Citation[] }>;
  commitments: Commitment[];
  risks: Risk[]; // added: the PRD (P3) requires risks
  openQuestions: string[];
  suggestedFollowUp: string;
  ticketDraft: TicketDraft;
  ticketStatus?: "proposed" | "none";
  previousReportId?: string;
  linearIssue?: LinearIssueRef;
  /** The accepted draft is frozen while an existing Linear attempt is reconciled. */
  linearIssueStatus?: "pending" | "created";
  createdAt: string;
  createdBy: string;
};

// ---------- Accounts ----------

export type Account = {
  id: string;
  name: string;
  allowedUserIds: string[];
};

export type PublicAccount = Omit<Account, "allowedUserIds">;

// ---------- GET /api/accounts/:id/brief ----------

export type BriefItem = {
  text: string;
  citations: Citation[];
  /** From the analysis agent, so the UI can badge risks and blockers. */
  type?: FindingType;
  severity?: "low" | "medium" | "high" | null;
};

export type AccountBrief = {
  summary: string;
  items: BriefItem[];
  openQuestions: string[];
};

export type AccountBriefResponse = {
  account: PublicAccount;
  emails: PublicSource[]; // newest first
  sources?: PublicSource[]; // supporting records, including internal apps and meetings
  brief: AccountBrief;
};

// ---------- POST /api/meetings/transcribe ----------
// Request: multipart/form-data with fields `accountId` and `audio` (normalized WAV audio extracted from the selected MP4 in the browser).

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
};

export type TranscribeResponse = {
  transcript: string;
  segments: TranscriptSegment[];
  /** "prepared-fallback" when Azure Speech failed and the prepared transcript was used. */
  origin: "azure-speech" | "prepared-fallback";
};

// ---------- POST /api/reports, GET /api/reports/:id ----------

export type CreateReportRequest = {
  accountId: string;
  previousReportId?: string;
  transcript: string; // reviewed/corrected by the presenter
};

export type ReportResponse = {
  report: MeetingReport;
  /** Every source cited in the report, so the UI can open excerpts without another call. */
  sources: PublicSource[];
};

// ---------- POST /api/reports/:id/linear ----------

export type CreateLinearIssueRequest = {
  ticket: TicketDraft; // the reviewed, possibly edited, draft
};

export type CreateLinearIssueResponse = {
  issue: LinearIssueRef;
  /** true when the issue already existed and was returned instead of creating another. */
  alreadyCreated: boolean;
};

// ---------- POST /api/chat ----------

export type ChatRequest = {
  accountId: string;
  question: string;
  reportId?: string;
  /** Untrusted conversational context, never a source of facts or permission grants. */
  history?: ChatMessage[];
};

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AssistantRefusal = "out_of_scope" | "restricted";

export type InvestigationStep = { action: "search" | "read" | "compare" | "verify"; label: string; sourceCount?: number };

export type ChatResponse = {
  steps?: InvestigationStep[];
  answer: string;
  citations: Citation[];
  sources: PublicSource[];
  /** false when the permitted sources do not support an answer. */
  grounded: boolean;
  responseType?: "answer" | "not_found" | AssistantRefusal;
};

// ---------- POST /api/claims/check ----------

export type ClaimVerdict = "supported" | "uncertain" | "contradicted";

export type ClaimCheckRequest = {
  accountId: string;
  statement: string;
  reportId?: string;
};

export type ClaimResult = { claim: string; verdict: ClaimVerdict; explanation: string; citations: Citation[] };

export type ClaimCheckResponse = {
  claimResults?: ClaimResult[];
  steps?: InvestigationStep[];
  verdict: ClaimVerdict;
  explanation: string;
  citations: Citation[];
  sources: PublicSource[];
  suggestedRewrite: string;
  refusalReason?: AssistantRefusal;
};

// ---------- POST /api/agent/analyze ----------
// Cross-source analysis: authorized sources in, grounded findings out. Downstream features
// (report, brief, chat, tickets) build on these findings instead of re-reading raw sources.

export type FindingType = "fact" | "decision" | "commitment" | "risk" | "blocker" | "conflict" | "open_question";

export type AgentFinding = {
  id: string; // "finding-1", stable within one analysis
  type: FindingType;
  title: string;
  description: string;
  /** "stated": a source says it outright. "inferred": the agent connected sources to conclude it. */
  basis: "stated" | "inferred";
  owner: string | null; // null unless a cited quote names the owner
  dueDate: string | null; // YYYY-MM-DD, null unless a cited quote states the date
  severity: "low" | "medium" | "high" | null;
  citations: Citation[]; // every one checked server-side: verbatim, permitted, same account
  relatedSourceIds: string[]; // distinct cited sources; length > 1 means sources corroborate each other
};

export type AnalyzeRequest = {
  accountId: string;
  /** Optional search terms to focus retrieval; omitted means the account's most recent sources. */
  focus?: string;
};

export type AgentAnalysis = {
  id: string;
  accountId: string;
  createdBy: string; // the user it was generated for; stored analyses are only returned to them
  summary: string;
  findings: AgentFinding[]; // most severe and best corroborated first
  /** Every source a finding cites (kind, title, author, app, body), so cards and drafts need no extra lookup. */
  sources: PublicSource[];
  analyzedSourceIds: string[]; // every source the model saw
  sourceFingerprint?: string; // detects edits as well as additions/removals in the current context
  generatedAt: string;
  /** What grounding removed: shown so nobody mistakes a trimmed result for the model's full output. */
  validation: { droppedCitations: number; droppedFindings: number };
};

// ---------- GET /api/accounts/:id/analysis ----------
// Returns the caller's latest stored AgentAnalysis for the account (404 if none yet). The UI, morning
// brief, action items, and Linear drafts read this instead of calling the model again.

// ---------- Ingestion: POST /api/ingest/emails, POST /api/ingest/apps/:appId, POST /api/meetings ----------

/** A raw input that did not become a source, and why. */
export type IngestRejection = { index: number; recordId: string | null; reason: string };

export type IngestResponse = {
  ingested: Array<Pick<SourceRecord, "id" | "accountId" | "kind" | "title">>;
  rejected: IngestRejection[];
};

/** Saves the presenter-reviewed transcript as the meeting source everything downstream cites. */
export type SaveMeetingRequest = {
  accountId: string;
  meetingId: string; // re-saving with the same ID replaces the earlier version
  transcript: string;
  occurredAt: string;
  title?: string;
};

// ---------- Errors (every endpoint) ----------

export type ApiErrorCode =
  | "UNAUTHENTICATED" // no signed-in user
  | "NOT_FOUND" // missing OR not permitted: the two are indistinguishable so nothing leaks
  | "BAD_REQUEST"
  | "TRANSCRIPTION_FAILED"
  | "INVALID_MODEL_OUTPUT"
  | "INTEGRATION_UNAVAILABLE";

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** For Linear failures: a prefilled Linear "new issue" link the UI can open instead. */
    fallbackUrl?: string;
  };
};

// Sample tool records and connector receipts contain fictional delivery data only.
export type DemoAppRecord = { id: string; revision: number; raw: Record<string, unknown> };
export type IntegrationStatus = {
  appId: string; name: string; configured: boolean; sample: boolean;
  accessMode: "account" | "source"; state: "ready" | "not_configured" | "synced" | "failed";
  lastSuccessfulSync?: string; accepted?: number; rejected?: number; error?: string;
  changedSourceIds?: string[];
};
export type IntegrationsResponse = { integrations: IntegrationStatus[]; demoAppsEnabled: boolean };
