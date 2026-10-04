import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localEnvironment } from './local-environment.mjs';
const directory = fileURLToPath(new URL('../', import.meta.url));
let env;
try { env = localEnvironment(directory); } catch { console.error('Configure the ignored local demo first: npm run configure:local -w api'); process.exit(1); }
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-workflow.ts'], { cwd: directory, stdio: 'inherit', env });
if (result.error) console.error('Configure the ignored local demo first: npm run configure:local -w api');
process.exit(result.status ?? 1);
