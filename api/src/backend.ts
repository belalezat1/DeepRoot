// The one place the Azure adapters plug into the backend. The Azure teammate implements
// BackendAdapters, calls createBackend once at startup, and each Azure Function calls one method
// with the parsed request. See docs/AZURE_INTEGRATION.md for the adapter contracts.
import { DEMO_SPEAKER_NAMES, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import type { AccountDirectory } from "./access.js";
import type { ChatModel } from "./agent/model.js";
import { handleAnalyze, handleGetLatestAnalysis, type AnalyzeHandlerInput } from "./handlers/analyze.js";
import { handleIngestAppRecords, handleIngestEmails, handleSaveMeeting, type IngestInput } from "./handlers/ingest.js";
import { handleTranscribe, type TranscribeRequest } from "./handlers/transcribe.js";
import { DEMO_EMAIL_ROUTING } from "./ingest/connectors/index.js";
import type { EmailRouting } from "./ingest/email.js";
import type { InternalAppConnector } from "./ingest/internal-app.js";
import type { TranscribeAudio } from "./ingest/meeting.js";
import type { AnalysisStore } from "./store/analyses.js";
import type { SourceSearch, SourceWriter } from "./store/sources.js";

/** Everything the Azure teammate implements for the ingestion and analysis routes. */
export type BackendAdapters = {
  accounts: AccountDirectory; // accounts container
  sources: SourceSearch & SourceWriter; // sources container / index
  analyses: AnalysisStore; // analyses container
  model: ChatModel; // Azure-hosted Gemini deployment
  transcribeAudio: TranscribeAudio; // Azure Speech
};

/** Demo-data settings; the defaults are the Northstar demo's. */
export type BackendOptions = {
  emailRouting?: EmailRouting;
  connectors?: InternalAppConnector[]; // defaults to every registered connector
  fallbackTranscripts?: Record<string, string>;
  speakerNames?: Record<string, Record<string, string>>;
};

/** Handlers with their adapters bound. Every method returns a HandlerResult ({ status, body }). */
export function createBackend(adapters: BackendAdapters, options: BackendOptions = {}) {
  const { accounts, sources, analyses, model, transcribeAudio } = adapters;
  const ingestDeps = { accounts, sources, emailRouting: options.emailRouting ?? DEMO_EMAIL_ROUTING, connectors: options.connectors };

  return {
    /** POST /api/meetings/transcribe (multipart: accountId, audio, file name) */
    transcribe: (req: TranscribeRequest) =>
      handleTranscribe(req, {
        accounts,
        transcribeAudio,
        fallbackTranscripts: options.fallbackTranscripts ?? { northstar: NORTHSTAR_MEETING_TRANSCRIPT },
        speakerNames: options.speakerNames ?? DEMO_SPEAKER_NAMES,
      }),
    /** POST /api/meetings (JSON SaveMeetingRequest) */
    saveMeeting: (input: IngestInput) => handleSaveMeeting(input, { accounts, sources }),
    /** POST /api/ingest/emails (JSON { emails: [...] }) */
    ingestEmails: (input: IngestInput) => handleIngestEmails(input, ingestDeps),
    /** POST /api/ingest/apps/{appId} (JSON { records: [...] }) */
    ingestAppRecords: (input: IngestInput & { appId: string }) => handleIngestAppRecords(input, ingestDeps),
    /** POST /api/agent/analyze (JSON AnalyzeRequest) */
    analyze: (input: AnalyzeHandlerInput) => handleAnalyze(input, { accounts, search: sources, model, analyses }),
    /** GET /api/accounts/{id}/analysis */
    latestAnalysis: (input: { user: AnalyzeHandlerInput["user"]; accountId: string }) =>
      handleGetLatestAnalysis(input, { accounts, analyses }),
  };
}

export type Backend = ReturnType<typeof createBackend>;
