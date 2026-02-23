import os from 'os';
import logger from './logger.js';

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export function logNetworkInfo() {
  try {
    const ip = getLocalIp();
    const port = process.env.PORT || 5050;
    const host = process.env.HOST || ip || 'localhost';
    const httpUrl = `http://${host}:${port}`;
    const httpsUrl = `https://${host}:${port}`;

    logger.info('[NetworkUtil] local network address ' + httpUrl);
    logger.info('[NetworkUtil] (http) network address: ' + httpUrl);
    logger.info('[NetworkUtil] (https) network address: ' + httpsUrl);

    // Suggest webhook using https (Paystack expects HTTPS for production)
    try {
      const suggestedWebhook = `${httpsUrl}/api/paystack/webhook`;
      logger.info('[NetworkUtil] suggested webhook URL (use https): ' + suggestedWebhook);
    } catch (e) {
      // ignore
    }

    if (process.env.FORCE_HTTPS === 'true') {
      logger.info('[NetworkUtil] to log active https scheme set FORCE_HTTPS=true');
    }
  } catch (err) {
    logger.warn('[NetworkUtil] failed to determine network info', { message: err.message });
  }
}

export default { logNetworkInfo };
