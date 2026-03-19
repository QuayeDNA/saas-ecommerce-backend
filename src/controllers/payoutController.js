// src/controllers/payoutController.js
import mongoose from 'mongoose';
import payoutService from '../services/payoutService.js';
import settingsService from '../services/settingsService.js';
import paystackService from '../services/paystackService.js';
import logger from '../utils/logger.js';

class PayoutController {
  async getEarningsDashboard(req, res) {
    try {
      const userId = req.user.userId;
      const data = await payoutService.getEarningsDashboard(userId);
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('[Payout] getEarningsDashboard error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async getPayouts(req, res) {
    try {
      const userId = req.user.userId;
      const status = req.query.status;
      const payouts = await payoutService.getPayoutsForUser(userId, { status });
      return res.json({ success: true, data: payouts });
    } catch (err) {
      logger.error('[Payout] getPayouts error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async requestPayout(req, res) {
    try {
      const userId = req.user.userId;
      const { amount, destination } = req.body;
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid amount is required' });
      }
      if (!destination || !destination.type) {
        return res.status(400).json({ success: false, message: 'Destination (type and details) is required' });
      }
      const { payout, autoPayoutEnabled } = await payoutService.requestPayout(userId, Number(amount), destination);

      // If auto-payout is enabled, immediately kick off the Paystack transfer in background
      if (autoPayoutEnabled) {
        // Don't await — let it run in background while we return 201 immediately
        payoutService.processAutoRequestedPayout(payout._id.toString()).catch((err) => {
          logger.error('[Payout] Background auto-payout failed', { payoutId: payout._id, message: err.message });
        });
        return res.status(201).json({
          success: true,
          message: 'Payout request submitted. Transfer initiated automatically — you will be notified when it completes.',
          data: payout,
          autoPayoutEnabled: true,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Payout request submitted. You will be notified when it is processed.',
        data: payout,
        autoPayoutEnabled: false,
      });
    } catch (err) {
      logger.error('[Payout] requestPayout error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async getPendingPayouts(req, res) {
    try {
      const { status } = req.query;
      const payouts = await payoutService.getPendingPayoutsForAdmin({ status });
      return res.json({ success: true, data: payouts });
    } catch (err) {
      logger.error('[Payout] getPendingPayouts error', { message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getPayoutHistory(req, res) {
    try {
      const { page, limit, status, userId, search, startDate, endDate } = req.query;
      const result = await payoutService.getPayoutHistoryForAdmin({
        page: Number(page) || 1,
        limit: Number(limit) || 25,
        status: status || undefined,
        userId: userId || undefined,
        search: search || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Payout] getPayoutHistory error', { message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async approvePayout(req, res) {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { transferReference } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Payout ID is required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid payout ID.' });
      }

      const payout = await payoutService.approvePayout(id, adminId, transferReference);
      return res.json({
        success: true,
        message: transferReference ? 'Payout approved and marked complete.' : 'Payout approved.',
        data: payout,
      });
    } catch (err) {
      logger.error('[Payout] approvePayout error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async rejectPayout(req, res) {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { reason } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Payout ID is required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid payout ID.' });
      }

      const payout = await payoutService.rejectPayout(id, adminId, reason);
      return res.json({
        success: true,
        message: 'Payout rejected.',
        data: payout,
      });
    } catch (err) {
      logger.error('[Payout] rejectPayout error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async processPayout(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ success: false, message: 'Payout ID is required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid payout ID.' });
      }

      const payout = await payoutService.processPayoutAuto(id);
      return res.json({
        success: true,
        message: 'Transfer initiated. Agent will be notified when complete.',
        data: payout,
      });
    } catch (err) {
      const errObj = err && typeof err === 'object' ? err : {};
      const apiData = errObj?.response?.data;
      const code = (apiData && apiData.code) || errObj.code || 'TRANSFER_FAILED';
      const status = (apiData && apiData.status) || errObj.status;
      
      // Sanitize the error: prefer the clean Paystack message if available, instead of "Request failed with status code 400..."
      const message = apiData?.message || (errObj && errObj.message) || String(err);

      logger.error(`[Payout] processPayout error: ${message} | code: ${code} | Paystack: ${JSON.stringify(apiData) ?? 'n/a'}`);

      return res.status(400).json({
        success: false,
        code,
        status,
        message,
      });
    }
  }

  async markManuallyCompleted(req, res) {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { transferReference } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, message: 'Payout ID is required.' });
      }
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid payout ID.' });
      }

      const payout = await payoutService.markManuallyCompleted(id, adminId, transferReference);
      return res.json({
        success: true,
        message: 'Payout marked as manually completed.',
        data: payout,
      });
    } catch (err) {
      logger.error(`[Payout] markManuallyCompleted error: ${err.message}`);
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async getAutoPayoutAvailability(req, res) {
    try {
      const payoutSettings = await settingsService.getPayoutSettings();
      const paystackConfigured = paystackService.isConfigured();
      const canAutoPayout = paystackConfigured && payoutSettings.autoPayoutEnabled;

      return res.json({
        success: true,
        data: {
          autoPayoutEnabled: payoutSettings.autoPayoutEnabled,
          canAutoPayout,
          paystackConfigured,
          message: paystackConfigured ? 'Auto payout is available' : 'Paystack is not configured for transfers',
        },
      });
    } catch (err) {
      logger.error(`[Payout] getAutoPayoutAvailability error: ${err.message}`);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new PayoutController();
