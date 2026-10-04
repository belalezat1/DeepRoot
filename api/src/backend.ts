// The one place the Azure adapters plug into the backend. The Azure teammate implements
// BackendAdapters, calls createBackend once at startup, and each Azure Function calls one method
// with the parsed request. See docs/AZURE_INTEGRATION.md for the adapter contracts.
import { createIntegrationService } from "./integrations/service.js";
import { InMemoryIntegrationStore, type IntegrationStore } from "./integrations/store.js";
import type { IntegrationConfig } from "./integrations/config.js";
import { INTERNAL_APP_CONNECTORS } from "./ingest/connectors/index.js";
import type { AgentAnalysis, LinearIssueRef } from "@deeproot/shared";
import { NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { AccountDirectory, SignedInUser } from "./access.js";
import type { ChatModel } from "./agent/model.js";
import { handleAnalyze, handleGetLatestAnalysis, type AnalyzeHandlerInput } from "./handlers/analyze.js";
import { handleGetBrief } from "./handlers/brief.js";
import { handleGetSource } from "./handlers/sources.js";
import { handleChat } from "./handlers/chat.js";
import { handleClaimCheck } from "./handlers/claims.js";
import { handleCreateLinearIssue } from "./handlers/createLinearIssue.js";
import { handleIngestAppRecords, handleIngestEmails, handleSaveMeeting, type IngestInput } from "./handlers/ingest.js";
import { handleCreateReport, handleGetReport } from "./handlers/reports.js";
import { handleTranscribe, type TranscribeRequest } from "./handlers/transcribe.js";
import { DEMO_EMAIL_ROUTING } from "./ingest/connectors/index.js";
import type { EmailRouting } from "./ingest/email.js";
import type { InternalAppConnector } from "./ingest/internal-app.js";
import type { TranscribeAudio } from "./ingest/meeting.js";
import type { LinearConfig } from "./linear/client.js";
import { type GenerateReport, createReportGenerator } from "./reports/generator.js";
import type { AnalysisStore } from "./store/analyses.js";
import type { ReportStore } from "./store/reports.js";
import type { SourceSearch, SourceWriter } from "./store/sources.js";

/** Everything the Azure teammate implements. */
export type BackendAdapters = {
  integrationStore?: IntegrationStore;
  accounts: AccountDirectory; // accounts container
  sources: SourceSearch & SourceWriter; // sources container / index
  analyses: AnalysisStore; // analyses container
  reports: ReportStore; // reports container
  model: ChatModel; // configured Gemini / Azure OpenAI / stub provider
  transcribeAudio: TranscribeAudio; // Azure Speech
};

/** Demo-data and integration settings; the defaults are the Northstar demo's. */
export type BackendOptions = {
  integrationConfig?: IntegrationConfig;
  emailRouting?: EmailRouting;
  connectors?: InternalAppConnector[]; // defaults to every registered connector
  fallbackTranscripts?: Record<string, string>;
  speakerNames?: Record<string, Record<string, string>>;
  /** Writes the meeting report; defaults to the configured model. Fixtures are explicit overrides. */
  generateReport?: GenerateReport;
  /** From LINEAR_API_KEY, LINEAR_TEAM_ID, LINEAR_TEAM_KEY. Omitted or null: Create in Linear returns the prefilled-form link. */
  linear?: LinearConfig | null;
  /** The deployed app URL (APP_BASE_URL); Linear issues link back to the report. */
  appBaseUrl?: string;
};

type UserInput = { user: SignedInUser | null };

/** Handlers with their adapters bound. Every method returns a HandlerResult ({ status, body }). */
export function createBackend(adapters: BackendAdapters, options: BackendOptions = {}) {
  const { accounts, sources, analyses, reports, model, transcribeAudio } = adapters;
  const ingestDeps = { accounts, sources, emailRouting: options.emailRouting ?? DEMO_EMAIL_ROUTING, connectors: options.connectors };
  const agentDeps = { accounts, search: sources, model, analyses };
  const briefDeps = { ...agentDeps, pendingBriefs: new Map<string, Promise<AgentAnalysis>>() };
  const reportDeps = {
    accounts,
    search: sources,
    sourceWriter: sources,
    reports,
    generateReport: options.generateReport ?? createReportGenerator(model),
  };
  const linearDeps = { accounts, reports, search: sources, linear: options.linear ?? null, appBaseUrl: options.appBaseUrl ?? "", pendingCreations: new Map<string, Promise<LinearIssueRef>>() };

  const integrations = createIntegrationService({ accounts, connectors: options.connectors ?? INTERNAL_APP_CONNECTORS, sources, store: adapters.integrationStore ?? new InMemoryIntegrationStore(), config: options.integrationConfig ?? { demoEnabled: false, demoAccounts: [], demoToken: "", http: {} } });
  return {
    integrations,
    /** POST /api/meetings/transcribe (multipart: accountId, audio, file name) */
    transcribe: (req: TranscribeRequest) =>
      handleTranscribe(req, {
        accounts,
        transcribeAudio,
        fallbackTranscripts: options.fallbackTranscripts ?? { northstar: NORTHSTAR_MEETING_TRANSCRIPT },
        speakerNames: options.speakerNames,
      }),
    /** POST /api/meetings (JSON SaveMeetingRequest) */
    saveMeeting: (input: IngestInput) => handleSaveMeeting(input, { accounts, sources }),
    /** POST /api/ingest/emails (JSON { emails: [...] }) */
    ingestEmails: (input: IngestInput) => handleIngestEmails(input, ingestDeps),
    /** POST /api/ingest/apps/{appId} (JSON { records: [...] }) */
    ingestAppRecords: (input: IngestInput & { appId: string }) => handleIngestAppRecords(input, ingestDeps),
    /** POST /api/agent/analyze (JSON AnalyzeRequest) */
    analyze: (input: AnalyzeHandlerInput) => handleAnalyze(input, agentDeps),
    /** GET /api/accounts/{id}/analysis */
    latestAnalysis: (input: UserInput & { accountId: string }) => handleGetLatestAnalysis(input, { accounts, analyses, search: sources }),
    /** GET /api/accounts/{id}/brief */
    brief: (input: UserInput & { accountId: string }) => handleGetBrief(input, briefDeps),
    /** POST /api/reports (JSON CreateReportRequest) */
    createReport: (input: UserInput & { body: unknown }) => handleCreateReport(input, reportDeps),
    /** GET /api/reports/{id} */
    getReport: (input: UserInput & { reportId: string }) => handleGetReport(input, reportDeps),
    getSource: (input: UserInput & { accountId: string; sourceId: string; reportId?: string; version?: string }) => handleGetSource(input, { accounts, search: sources, reports }),
    /** POST /api/reports/{id}/linear (JSON CreateLinearIssueRequest) */
    createLinearIssue: (input: UserInput & { reportId: string; body: unknown }) => handleCreateLinearIssue(input, linearDeps),
    /** POST /api/chat (JSON ChatRequest) */
    chat: (input: UserInput & { body: unknown }) => handleChat(input, { accounts, search: sources, reports, model }),
    /** POST /api/claims/check (JSON ClaimCheckRequest) */
    checkClaim: (input: UserInput & { body: unknown }) => handleClaimCheck(input, { accounts, search: sources, reports, model }),
  };
}

export type Backend = ReturnType<typeof createBackend>;
