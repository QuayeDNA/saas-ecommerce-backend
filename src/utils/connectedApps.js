import settingsService from '../services/settingsService.js';

export async function getConnectedAppByAppId(appId) {
  const apps = await settingsService.getConnectedApps();
  const app = apps.find(a => a.appId === appId);
  if (!app) throw new Error(`Connected app '${appId}' not found`);
  if (!app.enabled) throw new Error(`Connected app '${appId}' is disabled`);
  return app;
}

export async function makeRequest(app, method, path, body = null) {
  const url = `${app.baseUrl.replace(/\/+$/, '')}${path}`;

  let signal;
  try {
    signal = AbortSignal.timeout(30000);
  } catch {
    signal = undefined;
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${app.apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (signal) options.signal = signal;
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (fetchError) {
    throw new Error(`Request to ${url} failed: ${fetchError.message}`);
  }

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    throw new Error(`Non-JSON response from ${url} (HTTP ${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const err = new Error(data.message || data.error || `Request failed with status ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return data;
}
