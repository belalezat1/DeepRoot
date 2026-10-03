import { createAdapters } from "../adapters/index.js";
import { type Backend, createBackend } from "../backend.js";
import type { LinearConfig } from "../linear/client.js";
import { sampleReportGenerator } from "../reports/generator.js";
import { InMemoryAnalysisStore } from "../store/analyses.js";

export type FunctionDeps = {
  backend: Backend;
  backends: Record<string, string>;
};

let deps: FunctionDeps | undefined;

/**
 * The backend with Teammate 1's adapters plugged in, built once per process on first use. The Linear
 * handler's double-click protection lives in this process, so it must not be rebuilt per request.
 */
export function getDeps(env: NodeJS.ProcessEnv = process.env): FunctionDeps {
  if (deps) return deps;
  const adapters = createAdapters(env);
  const linear = linearConfig(env);

  const backend = createBackend(
    {
      accounts: adapters.accounts,
      // createBackend takes search and writes as one object; the adapters provide them separately.
      sources: {
        search: (req) => adapters.search.search(req),
        save: (source) => adapters.sourceWriter.save(source),
      },
      // No Cosmos container for analyses yet, so they live in this process (lost on restart).
      analyses: new InMemoryAnalysisStore(),
      reports: adapters.reports,
      model: adapters.chatModel,
      transcribeAudio: adapters.transcribeAudio,
    },
    {
      // Teammate 3's AI workflow replaces sampleReportGenerator.
      generateReport: sampleReportGenerator,
      linear,
      appBaseUrl: env.APP_BASE_URL ?? "",
    },
  );

  deps = {
    backend,
    backends: {
      ...adapters.backends,
      analyses: "memory",
      linear: linear ? "linear" : "fallback-link",
      auth: env.DEMO_USER_ID ? `demo mode, everyone is ${env.DEMO_USER_ID}` : "sign-in",
    },
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
