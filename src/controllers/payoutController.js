// src/controllers/payoutController.js
import mongoose from 'mongoose';
import payoutService from '../services/payoutService.js';
import settingsService from '../services/settingsService.js';
import paystackService from '../services/paystackService.js';
import logger from '../utils/logger.js';

// ─── Small Helpers ────────────────────────────────────────────────────────────

function validateObjectId(id, res) {
  if (!id) {
    res.status(400).json({ success: false, message: 'Payout ID is required.' });
    return false;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: 'Invalid payout ID.' });
    return false;
  }
  return true;
}

/**
 * Map a service-level error to a clean HTTP response.
 * Extracts `code` and `paystackData` attached by payoutService when Paystack rejects.
 */
function handlePayoutError(res, err, context) {
  logger.error(`[Payout] ${context}`, { message: err.message, code: err.code });

  const status  = err.code === 'NOT_FOUND' ? 404 : 400;
  const payload = {
    success: false,
    message: err.message,
    ...(err.code       && { code:        err.code }),
    ...(err.paystackData && { paystackData: err.paystackData }),
  };
  return res.status(status).json(payload);
}

// ─── Controller ───────────────────────────────────────────────────────────────

class PayoutController {

  // ── Agent Endpoints ──────────────────────────────────────────────────────────

  async getEarningsDashboard(req, res) {
    try {
      const data = await payoutService.getEarningsDashboard(req.user.userId);
      return res.json({ success: true, data });
    } catch (err) {
      logger.error('[Payout] getEarningsDashboard', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  async getPayouts(req, res) {
    try {
      const payouts = await payoutService.getPayoutsForUser(req.user.userId, {
        status: req.query.status,
      });
      return res.json({ success: true, data: payouts });
    } catch (err) {
      logger.error('[Payout] getPayouts', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/payouts/request
   * Agent submits a payout request.
   * Auto mode: fires transfer in background, returns immediately.
   * Semi-auto / Manual: queues for admin review.
   */
  async requestPayout(req, res) {
    try {
      const { amount, destination } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A valid amount is required.' });
      }
      if (!destination?.type) {
        return res.status(400).json({ success: false, message: 'destination.type is required.' });
      }

      const { payout, mode, autoPayoutEnabled } = await payoutService.requestPayout(
        req.user.userId, Number(amount), destination,
      );

      if (autoPayoutEnabled) {
        // Fire-and-forget — return 201 immediately, transfer runs in background
        payoutService.processAutoRequestedPayout(payout._id.toString()).catch((err) => {
          logger.error('[Payout] Background auto-payout failed', {
            payoutId: payout._id, code: err.code, message: err.message,
          });
        });

        return res.status(201).json({
          success: true,
          message: 'Payout requested. Transfer is being processed automatically — you will be notified on completion.',
          data:    payout,
          mode,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Payout request submitted. An admin will review it shortly.',
        data:    payout,
        mode,
      });
    } catch (err) {
      logger.error('[Payout] requestPayout', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // ── Admin Endpoints ──────────────────────────────────────────────────────────

  async getPendingPayouts(req, res) {
    try {
      const payouts = await payoutService.getPendingPayoutsForAdmin({ status: req.query.status });
      return res.json({ success: true, data: payouts });
    } catch (err) {
      logger.error('[Payout] getPendingPayouts', { message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getPayoutHistory(req, res) {
    try {
      const { page, limit, status, userId, search, startDate, endDate } = req.query;
      const result = await payoutService.getPayoutHistoryForAdmin({
        page:      Number(page)  || 1,
        limit:     Number(limit) || 25,
        status:    status    || undefined,
        userId:    userId    || undefined,
        search:    search    || undefined,
        startDate: startDate || undefined,
        endDate:   endDate   || undefined,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[Payout] getPayoutHistory', { message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/payouts/:id/approve
   * Admin approves a pending payout request (deducts earnings).
   * Passing body.transferReference skips Paystack and marks it completed immediately.
   */
  async approvePayout(req, res) {
    try {
      const { id } = req.params;
      if (!validateObjectId(id, res)) return;

      const payout = await payoutService.approvePayout(
        id, req.user.userId, req.body?.transferReference || null,
      );

      const message = req.body?.transferReference
        ? 'Payout approved and marked as completed.'
        : 'Payout approved. Use "Process via Paystack" to send the transfer.';

      return res.json({ success: true, message, data: payout });
    } catch (err) {
      return handlePayoutError(res, err, 'approvePayout');
    }
  }

  /**
   * POST /api/admin/payouts/:id/process
   * Admin triggers the Paystack transfer for an already-approved payout (semi-auto).
   */
  async processPayout(req, res) {
    try {
      const { id } = req.params;
      if (!validateObjectId(id, res)) return;

      const payout = await payoutService.processApprovedPayout(id);
      return res.json({
        success: true,
        message: 'Transfer initiated. The agent will be notified on completion.',
        data:    payout,
      });
    } catch (err) {
      return handlePayoutError(res, err, 'processPayout');
    }
  }

  /**
   * POST /api/admin/payouts/:id/reject
   * Admin rejects a payout. Refunds earnings if already deducted.
   */
  async rejectPayout(req, res) {
    try {
      const { id } = req.params;
      if (!validateObjectId(id, res)) return;

      const payout = await payoutService.rejectPayout(id, req.user.userId, req.body?.reason);
      return res.json({ success: true, message: 'Payout rejected.', data: payout });
    } catch (err) {
      return handlePayoutError(res, err, 'rejectPayout');
    }
  }

  /**
   * POST /api/admin/payouts/:id/complete
   * Admin manually marks a payout as completed (manual mode).
   * Works on 'approved', 'failed', or 'pending' (auto-fallback) payouts.
   */
  async markManuallyCompleted(req, res) {
    try {
      const { id } = req.params;
      if (!validateObjectId(id, res)) return;

      const payout = await payoutService.markManuallyCompleted(
        id, req.user.userId, req.body?.transferReference,
      );
      return res.json({
        success: true,
        message: 'Payout marked as completed.',
        data:    payout,
      });
    } catch (err) {
      return handlePayoutError(res, err, 'markManuallyCompleted');
    }
  }

  /**
   * GET /api/payouts/auto-availability
   * Returns whether auto-payout is available (Paystack configured + setting enabled).
   */
  async getAutoPayoutAvailability(req, res) {
    try {
      const [payoutSettings, paystackConfigured] = await Promise.all([
        settingsService.getPayoutSettings(),
        Promise.resolve(paystackService.isConfigured()),
      ]);

      const canAutoPayout = paystackConfigured && payoutSettings.autoPayoutEnabled;

      return res.json({
        success: true,
        data: {
          autoPayoutEnabled: payoutSettings.autoPayoutEnabled,
          paystackConfigured,
          canAutoPayout,
          message: canAutoPayout
            ? 'Auto-payout is available.'
            : paystackConfigured
              ? 'Auto-payout is disabled by an administrator.'
              : 'Paystack is not configured for transfers.',
        },
      });
    } catch (err) {
      logger.error('[Payout] getAutoPayoutAvailability', { message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new PayoutController();