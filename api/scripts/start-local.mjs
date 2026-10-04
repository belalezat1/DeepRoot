import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localEnvironment } from './local-environment.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
let env;
try { env = localEnvironment(directory); } catch { console.error('Run npm run configure:local -w api first.'); process.exit(1); }
const host = spawn(process.platform === 'win32' ? 'func.cmd' : 'func', ['start', '--script-root', 'deploy', '--port', '7071'], { cwd: directory, env, stdio: 'inherit' });
host.on('error', () => { console.error('Install Azure Functions Core Tools v4 to start the local API.'); process.exitCode = 1; });
host.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => host.kill(signal));
