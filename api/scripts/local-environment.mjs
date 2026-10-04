import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function localEnvironment(directory) {
  const profile = parseEnv(readFileSync(`${directory}.env.local-demo`, 'utf8'));
  const env = { ...process.env };
  delete env.AzureWebJobsStorage;
  for (const key of Object.keys(env)) {
    if (/^(COSMOS_|AZURE_SEARCH_|LINEAR_|AZURE_SPEECH_|MODEL_|GEMINI_|AZURE_OPENAI_|CONNECTOR_|EMAIL_ROUTING_|DEMO_)/.test(key)) delete env[key];
  }
  const allowed = /^(MODEL_|GEMINI_|AZURE_OPENAI_|DEMO_USER_ID$|ENABLE_DEMO_APPS$|DEMO_APP_ACCOUNT_IDS$|DEMO_APPS_TOKEN$|DEMO_APPS_BASE_URL$|APP_BASE_URL$|FUNCTIONS_WORKER_RUNTIME$)/;
  return { ...env, ...Object.fromEntries(Object.entries(profile).filter(([key]) => allowed.test(key))) };
}
