// Deeproot shared contracts. Changes go through Teammate 4; tell the team before editing.
// Types marked "from BUILD_PLAN" are the agreed shapes; the rest fill in the API contract.

// ---------- Core records (from BUILD_PLAN) ----------

export type SourceKind = "email" | "meeting";

export type SourceRecord = {
  id: string;
  accountId: string;
  kind: SourceKind;
  title: string;
  author: string;
  occurredAt: string; // ISO 8601
  body: string;
  allowedUserIds: string[];
};

/** A SourceRecord as sent to the browser: the access list stays on the server. */
export type PublicSource = Omit<SourceRecord, "allowedUserIds">;

export type Citation = {
  sourceId: string;
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
  decisions: Array<{ text: string; citations: Citation[] }>;
  commitments: Commitment[];
  risks: Risk[]; // added: the PRD (P3) requires risks
  openQuestions: string[];
  suggestedFollowUp: string;
  ticketDraft: TicketDraft;
  linearIssue?: LinearIssueRef;
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
};

export type AccountBrief = {
  summary: string;
  items: BriefItem[];
  openQuestions: string[];
};

export type AccountBriefResponse = {
  account: PublicAccount;
  emails: PublicSource[]; // newest first
  brief: AccountBrief;
};

// ---------- POST /api/meetings/transcribe ----------
// Request: multipart/form-data with fields `accountId` and `audio` (WAV file).

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
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
  sources: PublicSource[];
  /** false when the permitted sources do not support an answer. */
  grounded: boolean;
};

// ---------- POST /api/claims/check ----------

export type ClaimVerdict = "supported" | "uncertain" | "contradicted";

export type ClaimCheckRequest = {
  accountId: string;
  statement: string;
};

export type ClaimCheckResponse = {
  verdict: ClaimVerdict;
  explanation: string;
  citations: Citation[];
  sources: PublicSource[];
  suggestedRewrite: string;
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
