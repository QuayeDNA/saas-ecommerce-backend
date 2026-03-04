// src/controllers/payoutController.js
import payoutService from '../services/payoutService.js';
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

  async approvePayout(req, res) {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { transferReference } = req.body || {};
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
      const payout = await payoutService.processPayoutAuto(id);
      return res.json({
        success: true,
        message: 'Transfer initiated. Agent will be notified when complete.',
        data: payout,
      });
    } catch (err) {
      logger.error('[Payout] processPayout error', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }
}

export default new PayoutController();
