#!/usr/bin/env node
// Запускает API-сервер и веб-клиент одной командой: `npm run dev`.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const procs = [
  { name: 'api', color: '\x1b[35m', args: ['run', 'dev', '-w', '@omni/server'] },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev', '-w', '@omni/web'] },
];

const children = procs.map(({ name, color, args }) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: isWin, env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}завершился с кодом ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

console.log('\n  Omni запускается…  Откройте http://localhost:5173\n');

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
