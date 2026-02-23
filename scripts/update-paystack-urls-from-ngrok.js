#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

async function getNgrokTunnels() {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (!res.ok) throw new Error(`ngrok API returned ${res.status}`);
    const data = await res.json();
    return data.tunnels || [];
  } catch (e) {
    throw new Error('Failed to contact ngrok local API: ' + e.message);
  }
}

function updateEnvFile(envPath, webhookUrl, callbackUrl) {
  let content = '';
  if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');

  const setOrReplace = (key, value, src) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(src)) return src.replace(re, `${key}=${value}`);
    return src + `\n${key}=${value}\n`;
  };

  content = setOrReplace('PAYSTACK_WEBHOOK_URL_DEV', webhookUrl, content);
  content = setOrReplace('PAYSTACK_CALLBACK_URL_DEV', callbackUrl, content);

  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const tunnels = await getNgrokTunnels();
    const httpsTunnel = tunnels.find(t => t.public_url && t.public_url.startsWith('https://')) || tunnels[0];
    if (!httpsTunnel) throw new Error('No ngrok tunnels found. Start ngrok first.');

    const publicUrl = httpsTunnel.public_url.replace(/\/$/, '');
    const webhookUrl = `${publicUrl}/api/webhooks/paystack`;
    // For callback, we set to the public URL + the frontend callback path. Adjust if you use a separate frontend ngrok.
    const callbackUrl = `${publicUrl}/wallet/topup/callback`;

    updateEnvFile(envPath, webhookUrl, callbackUrl);
    console.log('Updated .env with Paystack dev URLs:');
    console.log('PAYSTACK_WEBHOOK_URL_DEV=', webhookUrl);
    console.log('PAYSTACK_CALLBACK_URL_DEV=', callbackUrl);
    console.log('Restart your backend to pick up .env changes.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
