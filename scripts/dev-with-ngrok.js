#!/usr/bin/env node
import { spawn } from 'child_process';

function startProcess(command, args, name) {
  const p = spawn(command, args, { stdio: 'inherit', shell: true });
  p.on('close', (code, signal) => {
    console.log(`${name} exited with code ${code} signal ${signal}`);
    process.exit(code ?? 0);
  });
  p.on('error', (err) => {
    console.error(`${name} error:`, err);
  });
  return p;
}

console.log('Starting backend (nodemon) and ngrok tunnel...');
const backend = startProcess('npm', ['run', 'dev'], 'backend');
// Use npx so ngrok binary is available without global install
const ngrok = startProcess('npx', ['ngrok', 'http', '5050', '--log=stdout'], 'ngrok');

function shutdown() {
  console.log('Shutting down helper and children...');
  if (backend && !backend.killed) backend.kill('SIGINT');
  if (ngrok && !ngrok.killed) ngrok.kill('SIGINT');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep process alive
process.stdin.resume();
