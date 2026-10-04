// Writes only ignored local configuration. No Azure mutations and no cloud data integrations.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../', import.meta.url));
const modelNames = /^(MODEL_(PROVIDER|FALLBACK)|GEMINI_(API_KEY|MODEL|THINKING_LEVEL|TIMEOUT_MS)|AZURE_OPENAI_(ENDPOINT|API_KEY|DEPLOYMENT|API_VERSION))$/;
let settings = {};
try {
  settings = Object.fromEntries(Object.entries(parseEnv(readFileSync(`${directory}.env`, 'utf8'))).filter(([key]) => modelNames.test(key)));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (process.argv.includes('--from-azure')) {
  const result = spawnSync('az', ['staticwebapp', 'appsettings', 'list', '-n', 'deeproot-web-ya332', '-g', 'rg-deeproot', '--query', 'properties', '-o', 'json'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) { console.error('Azure CLI is unavailable or not authenticated. Configure api/.env locally; keys are never printed.'); process.exit(1); }
  const cloud = JSON.parse(result.stdout);
  settings = Object.fromEntries(Object.entries(cloud).filter(([key]) => modelNames.test(key)));
}
settings = { MODEL_PROVIDER: 'stub', MODEL_FALLBACK: '', ...settings, DEMO_USER_ID: 'presenter', ENABLE_DEMO_APPS: 'true', DEMO_APP_ACCOUNT_IDS: 'northstar', DEMO_APPS_TOKEN: randomBytes(24).toString('hex'), DEMO_APPS_BASE_URL: 'http://localhost:7071', APP_BASE_URL: 'http://localhost:5173', FUNCTIONS_WORKER_RUNTIME: 'node' };
writeFileSync(`${directory}.env.local-demo`, Object.entries(settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
// Functions consumes exactly these values. It cannot inherit cloud storage/Linear configuration from this file.
writeFileSync(`${directory}local.settings.json`, JSON.stringify({ IsEncrypted: false, Values: settings }, null, 2) + '\n', { mode: 0o600 });
chmodSync(`${directory}.env.local-demo`, 0o600); chmodSync(`${directory}local.settings.json`, 0o600);
console.log(`Local demo configured: model=${settings.MODEL_PROVIDER}; storage/search=memory; Linear=disabled. Ignored configuration written without printing credentials.`);
