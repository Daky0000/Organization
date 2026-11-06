import { spawn } from 'child_process';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const run = (command) =>
  spawn(command, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });

console.log('Starting local development environment...');
console.log('Frontend with live source updates: http://localhost:3000');
console.log('Backend API and built static app: http://localhost:5000');
console.log('Open http://localhost:3000 to see recent frontend changes.');

const frontend = run(`${npmCmd} run dev:web`);
const backend = run(`${npmCmd} run dev:api`);

let shuttingDown = false;

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!frontend.killed) frontend.kill();
  if (!backend.killed) backend.kill();
  process.exit(exitCode);
};

frontend.on('exit', (code) => shutdown(typeof code === 'number' ? code : 0));
backend.on('exit', (code) => shutdown(typeof code === 'number' ? code : 0));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
