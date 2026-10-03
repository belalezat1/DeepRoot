import { DEMO_SPEAKER_NAMES, NORTHSTAR_MEETING_TRANSCRIPT } from "@deeproot/demo";
import { createAdapters } from "../adapters/index.js";
import type { AnalyzeDeps } from "../agent/analyze.js";
import type { CreateLinearIssueDeps } from "../handlers/createLinearIssue.js";
import type { ReportDeps } from "../handlers/reports.js";
import type { TranscribeDeps } from "../handlers/transcribe.js";
import type { LinearConfig } from "../linear/client.js";
import { sampleReportGenerator } from "../reports/generator.js";

export type FunctionDeps = {
  reports: ReportDeps;
  linear: CreateLinearIssueDeps;
  analyze: AnalyzeDeps;
  transcribe: TranscribeDeps;
  backends: Record<string, string>;
};

let deps: FunctionDeps | undefined;

/**
 * Everything the handlers need, built once per process on first use. The Linear handler's
 * double-click protection lives in this process, so it must not be rebuilt per request.
 */
export function getDeps(env: NodeJS.ProcessEnv = process.env): FunctionDeps {
  if (deps) return deps;
  const adapters = createAdapters(env);
  const { accounts, search, sourceWriter, reports } = adapters;

  deps = {
    // Teammate 3's AI workflow replaces sampleReportGenerator.
    reports: { accounts, search, sourceWriter, reports, generateReport: sampleReportGenerator },
    linear: { reports, accounts, linear: linearConfig(env), appBaseUrl: env.APP_BASE_URL ?? "" },
    analyze: { accounts, search, model: adapters.chatModel },
    transcribe: {
      getAccount: async (accountId) => (await accounts.getAccount(accountId)) ?? undefined,
      transcribeAudio: adapters.transcribeAudio,
      fallbackTranscripts: { northstar: NORTHSTAR_MEETING_TRANSCRIPT },
      speakerNames: DEMO_SPEAKER_NAMES,
    },
    backends: { ...adapters.backends, linear: linearConfig(env) ? "linear" : "fallback-link" },
  };
  return deps;
}

/** Null when the key or team ID is missing: the handler then returns a prefilled Linear link instead. */
function linearConfig(env: NodeJS.ProcessEnv): LinearConfig | null {
  if (!env.LINEAR_API_KEY || !env.LINEAR_TEAM_ID) return null;
  return {
    apiKey: env.LINEAR_API_KEY,
    teamId: env.LINEAR_TEAM_ID,
    ...(env.LINEAR_TEAM_KEY ? { teamKey: env.LINEAR_TEAM_KEY } : {}),
  };
}
