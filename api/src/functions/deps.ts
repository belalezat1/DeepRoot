import { integrationConfig } from "../integrations/config.js";
import { createAdapters } from "../adapters/index.js";
import { type Backend, createBackend } from "../backend.js";
import type { LinearConfig } from "../linear/client.js";
import { sourceConfig } from "./sourceConfig.js";

export type FunctionDeps = {
  backend: Backend;
  backends: Record<string, string>;
};

let deps: FunctionDeps | undefined;

/**
 * Adapter connections and backend dependencies, built once per process on first use.
 */
export function getDeps(env: NodeJS.ProcessEnv = process.env): FunctionDeps {
  if (deps) return deps;
  const adapters = createAdapters(env);
  const linear = linearConfig(env);

  const backend = createBackend(
    {
      accounts: adapters.accounts,
      integrationStore: adapters.integrationStore,
      // createBackend takes search and writes as one object; the adapters provide them separately.
      sources: {
        search: (req) => adapters.search.search(req),
        get: (accountId, id) => adapters.search.get!(accountId, id),
        save: (source) => adapters.sourceWriter.save(source),
        remove: (accountId, id) => adapters.sourceWriter.remove!(accountId, id),
      },
      // No Cosmos container for analyses yet, so they live in this process (lost on restart).
      analyses: adapters.analyses,
      reports: adapters.reports,
      model: adapters.chatModel,
      transcribeAudio: adapters.transcribeAudio,
    },
    {
      ...sourceConfig(env),
      integrationConfig: integrationConfig(env),
      linear,
      appBaseUrl: env.APP_BASE_URL ?? "",
    },
  );

  deps = {
    backend,
    backends: {
      ...adapters.backends,
      analyses: adapters.backends.storage === "cosmos" ? "cosmos" : "memory",
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
