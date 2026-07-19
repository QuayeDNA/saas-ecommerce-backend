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
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${app.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed with status ${response.status}`);
  }

  return data;
}
