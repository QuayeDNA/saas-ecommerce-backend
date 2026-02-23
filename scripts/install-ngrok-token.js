#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';

const token = process.argv[2] || process.env.NGROK_AUTHTOKEN;
if (!token) {
  console.error('Usage: node scripts/install-ngrok-token.js <authtoken>');
  process.exit(2);
}

const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
const ngrokDir = path.join(home, '.ngrok2');
const cfgPath = path.join(ngrokDir, 'ngrok.yml');

try {
  fs.mkdirSync(ngrokDir, { recursive: true });
  const content = `authtoken: ${token}\n`;
  fs.writeFileSync(cfgPath, content, { encoding: 'utf8', mode: 0o600 });
  console.log(`Wrote ngrok authtoken to ${cfgPath}`);
  console.log('You can now run `npx ngrok http 5050` or `npm run dev:with-ngrok`.');
} catch (e) {
  console.error('Failed to write ngrok config:', e.message);
  process.exit(1);
}
