import * as crossAppBridgeWalletService from '../services/crossAppBridgeWalletService.js';
import logger from '../utils/logger.js';

function getStatusFromError(error) {
  const msg = error.message;
  if (msg.includes('not found') || msg.includes('disabled')) return 404;
  return 502;
}

export async function listConnectedAppTransactions(req, res) {
  try {
    const result = await crossAppBridgeWalletService.listTransactionsFromApp(req.params.appId, req.query);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app list wallet transactions error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function getConnectedAppAnalytics(req, res) {
  try {
    const result = await crossAppBridgeWalletService.getAnalyticsFromApp(req.params.appId);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app get wallet analytics error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function getConnectedAppPendingRequests(req, res) {
  try {
    const result = await crossAppBridgeWalletService.getPendingRequestsFromApp(req.params.appId, req.query);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app get pending requests error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function topUpConnectedAppWallet(req, res) {
  try {
    const { userId, amount, description } = req.body;
    const result = await crossAppBridgeWalletService.topUpWalletOnApp(req.params.appId, userId, amount, description);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app top-up wallet error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function debitConnectedAppWallet(req, res) {
  try {
    const { userId, amount, description } = req.body;
    const result = await crossAppBridgeWalletService.debitWalletOnApp(req.params.appId, userId, amount, description);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app debit wallet error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function processConnectedAppTopUpRequest(req, res) {
  try {
    const { approve } = req.body;
    const result = await crossAppBridgeWalletService.processTopUpRequestOnApp(req.params.appId, req.params.transactionId, approve);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app process top-up request error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}

export async function getConnectedAppUsers(req, res) {
  try {
    const result = await crossAppBridgeWalletService.getUsersFromApp(req.params.appId, req.query);
    res.json(result);
  } catch (error) {
    logger.error(`Cross-app get users error: ${error.message}`);
    res.status(getStatusFromError(error)).json({ success: false, message: error.message });
  }
}
