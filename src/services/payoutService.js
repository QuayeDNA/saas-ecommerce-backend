// src/services/payoutService.js
import mongoose from 'mongoose';
import PayoutRequest from '../models/PayoutRequest.js';
import EarningsTransaction from '../models/EarningsTransaction.js';
import User from '../models/User.js';
import paystackService from './paystackService.js';
import notificationService from './notificationService.js';
import logger from '../utils/logger.js';
import settingsService from './settingsService.js';
import { getFeeConfig } from '../utils/paystackHelpers.js';

// constants removed; values come from settings

class PayoutService {
  /**
   * Calculate the Paystack transfer fee and net amount for a payout.
   * @param {number} amount - Gross payout amount in GHS
   * @param {'mobile_money'|'bank_account'} destinationType
   * @returns {{ transferFee: number, netAmount: number, feeBearer: string }}
   */
  async calculateTransferFee(amount, destinationType) {
    const feeConfig = await getFeeConfig();
    const transferFees = feeConfig.paystackTransferFees || {};
    const transferFee = destinationType === 'bank_account'
      ? (transferFees.bank_account ?? 8.0)
      : (transferFees.mobile_money ?? 1.0);
    const feeBearer = feeConfig.payoutFeeBearer || 'agent';

    // If agent bears fees, they receive less. If platform bears, they receive full amount.
    const netAmount = feeBearer === 'agent'
      ? Math.max(0, amount - transferFee)
      : amount;

    return { transferFee, netAmount, feeBearer };
  }

  // helper that attempts a mongodb transaction and gracefully falls back to
  // non-transactional execution if the server isn't a replica set (e.g. local
  // development).  Mirrors orderService.executeWithTransaction.
  async withTransaction(operation) {
    try {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        const result = await operation(session);
        await session.commitTransaction();
        session.endSession();
        return result;
      } catch (opErr) {
        // abort if possible then rethrow
        try {
          if (session.transaction && session.transaction.state === 'TRANSACTION_STARTED') {
            await session.abortTransaction();
          }
        } catch (abortErr) {
          logger.warn('[Payout] failed to abort transaction', { message: abortErr.message });
        }
        session.endSession();
        throw opErr;
      }
    } catch (startErr) {
      // transactions not supported (standalone) - warn and run without session
      logger.warn('[Payout] transactions unavailable, running without session', { message: startErr.message });
      return await operation(null);
    }
  }

  async requestPayout(userId, amount, destination) {
    return await this.withTransaction(async (session) => {
      const queryOpts = session ? { session } : undefined;
      const user = await User.findById(userId, null, queryOpts);
      if (!user) throw new Error('User not found');

      const balance = Number(user.earningsBalance) || 0;
      if (balance < amount) {
        throw new Error(`Insufficient earnings. Available: GHS ${balance.toFixed(2)}`);
      }

      // fetch configured minimums
      const { minimumPayoutAmounts } = await settingsService.getPayoutSettings();
      const minPayout = destination.type === 'bank_account'
        ? minimumPayoutAmounts.bank_account
        : minimumPayoutAmounts.mobile_money;
      if (amount < minPayout) {
        throw new Error(`Minimum payout: GHS ${minPayout}`);
      }

      const existingPending = await PayoutRequest.findOne({
        user: userId,
        status: 'pending',
      }, null, queryOpts);

      if (existingPending) {
        throw new Error('You have a pending payout request. Please wait for it to be processed.');
      }

      await this.validateDestination(destination, user);

      // Calculate transfer fee and net amount
      const { transferFee, netAmount, feeBearer } = await this.calculateTransferFee(amount, destination.type);

      const payout = new PayoutRequest({
        user: userId,
        amount,
        transferFee,
        netAmount,
        destination,
        requestedAt: new Date(),
        metadata: { feeBearer },
      });
      if (session) {
        await payout.save({ session });
      } else {
        await payout.save();
      }

      logger.info('[Payout] Request created', { userId, amount, payoutId: payout._id });

      try {
        const admins = await User.find({ userType: 'super_admin', isActive: true }).select('_id');
        for (const admin of admins) {
          await notificationService.createInAppNotification(
            admin._id.toString(),
            'New Payout Request',
            `${user.fullName} requested a payout of GHS ${amount.toFixed(2)}`,
            'info',
            { type: 'payout_request', payoutId: payout._id }
          );
        }
      } catch (notifErr) {
        logger.warn('[Payout] Failed to notify admins', { message: notifErr.message });
      }

      return payout;
    });
  }

  async approvePayout(payoutId, adminId, transferReference = null) {
    return await this.withTransaction(async (session) => {
      const queryOpts = session ? { session } : undefined;
      let payout;
      if (session) {
        payout = await PayoutRequest.findById(payoutId).populate('user').session(session);
      } else {
        payout = await PayoutRequest.findById(payoutId).populate('user');
      }
      if (!payout) throw new Error('Payout not found');
      if (payout.status !== 'pending') {
        throw new Error(`Payout is already ${payout.status}`);
      }

      const user = payout.user;
      const balance = Number(user.earningsBalance) || 0;
      if (balance < payout.amount) {
        throw new Error('Insufficient earnings balance');
      }

      user.earningsBalance = balance - payout.amount;
      if (session) {
        await user.save({ session, validateBeforeSave: false });
      } else {
        await user.save({ validateBeforeSave: false });
      }

      const txData = [
        {
          user: user._id,
          type: 'payout',
          amount: -payout.amount,
          balanceAfter: user.earningsBalance,
          description: `Payout request #${payout._id}`,
          relatedPayout: payout._id,
          metadata: { destination: payout.destination },
        },
      ];
      if (session) {
        await EarningsTransaction.create(txData, { session });
      } else {
        await EarningsTransaction.create(txData);
      }

      payout.status = 'approved';
      payout.reviewedBy = adminId;
      payout.reviewedAt = new Date();
      payout.processedAt = new Date();
      if (transferReference) {
        payout.status = 'completed';
        payout.completedAt = new Date();
        payout.paystackTransfer = payout.paystackTransfer || {};
        payout.paystackTransfer.transferReference = transferReference;
      }
      if (session) {
        await payout.save({ session });
      } else {
        await payout.save();
      }

      logger.info('[Payout] Approved', { payoutId, userId: user._id, amount: payout.amount });

      try {
        await notificationService.createInAppNotification(
          user._id.toString(),
          'Payout Approved',
          `Your payout request of GHS ${payout.amount.toFixed(2)} has been approved.${transferReference ? ' Transfer reference: ' + transferReference : ''}`,
          'success',
          { type: 'payout_approved', payoutId: payout._id }
        );
      } catch (notifErr) {
        logger.warn('[Payout] Failed to notify agent', { message: notifErr.message });
      }

      return payout;
    });
  }

  async rejectPayout(payoutId, adminId, rejectionReason) {
    const payout = await PayoutRequest.findById(payoutId).populate('user');
    if (!payout) throw new Error('Payout not found');
    if (payout.status !== 'pending') {
      throw new Error(`Payout is already ${payout.status}`);
    }

    payout.status = 'rejected';
    payout.reviewedBy = adminId;
    payout.reviewedAt = new Date();
    payout.rejectionReason = rejectionReason || 'Rejected by administrator';
    await payout.save();

    logger.info('[Payout] Rejected', { payoutId, userId: payout.user._id });

    try {
      await notificationService.createInAppNotification(
        payout.user._id.toString(),
        'Payout Rejected',
        `Your payout request of GHS ${payout.amount.toFixed(2)} was rejected. ${payout.rejectionReason}`,
        'error',
        { type: 'payout_rejected', payoutId: payout._id }
      );
    } catch (notifErr) {
      logger.warn('[Payout] Failed to notify agent', { message: notifErr.message });
    }

    return payout;
  }

  async processPayoutAuto(payoutId) {
    const payout = await PayoutRequest.findById(payoutId).populate('user');
    if (!payout) throw new Error('Payout not found');
    if (payout.status !== 'approved') {
      throw new Error('Payout must be approved first');
    }

    // Recalculate fees if not already set or if transferFee is 0 (legacy/unconfigured payouts)
    if (payout.netAmount == null || payout.transferFee == null || payout.transferFee === 0) {
      const { transferFee, netAmount, feeBearer } = await this.calculateTransferFee(
        payout.amount,
        payout.destination?.type || 'mobile_money'
      );
      payout.transferFee = transferFee;
      payout.netAmount = netAmount;
      payout.metadata = { ...payout.metadata, feeBearer };
    }

    let recipientCode = payout.destination?.recipientCode;
    if (!recipientCode) {
      recipientCode = await this.createPaystackRecipient(payout);
      payout.destination = payout.destination || {};
      payout.destination.recipientCode = recipientCode;
      await payout.save();
    }

    const transferRef = `payout_${payout._id}_${Date.now()}`;

    // Transfer the net amount (after fee deduction if agent bears fees)
    // Paystack charges the transfer fee on top of the transfer amount,
    // so we send the net amount the agent should receive.
    const transferAmountGHS = payout.netAmount;

    try {
      await paystackService.ensureKeys();
      const transfer = await paystackService.initiateTransfer({
        source: 'balance',
        amount: paystackService.convertToPesewas(transferAmountGHS),
        recipient: recipientCode,
        reference: transferRef,
        reason: `Payout for ${payout.user?.fullName || payout.userId}`,
      });

      payout.status = 'processing';
      payout.paystackTransfer = {
        transferCode: transfer.transfer_code || transfer.id,
        transferReference: transferRef,
        recipientCode,
        status: transfer.status || 'pending',
        transferredAt: new Date(),
      };
      await payout.save();

      logger.info('[Payout] Transfer initiated', { payoutId, transferCode: transfer.transfer_code });
      return payout;
    } catch (err) {
      // Save the failure reason before refunding so the original Paystack error is preserved
      const originalError = err;
      payout.status = 'failed';
      payout.paystackTransfer = payout.paystackTransfer || {};
      payout.paystackTransfer.failureReason = err.message;
      try { await payout.save(); } catch (saveErr) {
        logger.warn('[Payout] Failed to save failure status', { payoutId, message: saveErr.message });
      }
      logger.error('[Payout] Transfer failed', { payoutId, error: err.message });
      try {
        await this.refundFailedPayout(payout);
      } catch (refundErr) {
        // Log but don't mask the original Paystack error
        logger.error('[Payout] Refund failed after transfer failure', { payoutId, message: refundErr.message });
      }
      throw originalError;
    }
  }

  async createPaystackRecipient(payout) {
    const dest = payout.destination;
    const name = dest.recipientName || payout.user?.fullName || 'Recipient';

    const data = {
      name,
      currency: 'GHS',
    };

    if (dest.type === 'mobile_money') {
      data.type = 'mobile_money';
      data.account_number = dest.phoneNumber;
      data.bank_code = dest.mobileProvider;
    } else {
      data.type = 'nuban';
      data.account_number = dest.accountNumber;
      data.bank_code = dest.bankCode;
    }

    const recipient = await paystackService.createTransferRecipient(data);
    return recipient.recipient_code;
  }

  async validateDestination(destination, user) {
    if (destination.type === 'mobile_money') {
      if (!this.isValidGhanaPhone(destination.phoneNumber)) {
        throw new Error('Invalid Ghana phone number format');
      }
      const network = this.detectNetwork(destination.phoneNumber);
      if (network !== destination.mobileProvider) {
        throw new Error(`Phone number does not match ${destination.mobileProvider} network`);
      }
    } else if (destination.type === 'bank_account') {
      try {
        const resolved = await paystackService.resolveAccountNumber(
          destination.accountNumber,
          destination.bankCode
        );
        destination.recipientName = resolved.account_name;
      } catch (err) {
        throw new Error('Could not verify bank account details. Please check account number and bank.');
      }
    }
  }

  async handleTransferWebhook(event) {
    const { data } = event;
    const reference = data.reference;

    const payout = await PayoutRequest.findOne({
      'paystackTransfer.transferReference': reference,
    }).populate('user');

    if (!payout) {
      logger.warn('[Payout Webhook] Payout not found', { reference });
      return;
    }

    if (event.event === 'transfer.success') {
      payout.status = 'completed';
      payout.completedAt = new Date();
      if (payout.paystackTransfer) payout.paystackTransfer.status = 'success';
      await payout.save();

      logger.info('[Payout Webhook] Transfer successful', { payoutId: payout._id, amount: payout.amount });

      try {
        await notificationService.createInAppNotification(
          payout.user._id.toString(),
          'Payout Completed',
          `Your payout of GHS ${payout.amount.toFixed(2)} has been sent successfully.`,
          'success',
          { type: 'payout_completed', payoutId: payout._id }
        );
      } catch (notifErr) {
        logger.warn('[Payout Webhook] Failed to notify agent', { message: notifErr.message });
      }
    } else if (event.event === 'transfer.failed') {
      payout.status = 'failed';
      if (payout.paystackTransfer) {
        payout.paystackTransfer.status = 'failed';
        payout.paystackTransfer.failureReason = data.failure_reason || data.reason || 'Transfer failed';
      }
      await payout.save();

      logger.error('[Payout Webhook] Transfer failed', { payoutId: payout._id, reason: data.failure_reason });

      await this.refundFailedPayout(payout);

      try {
        await notificationService.createInAppNotification(
          payout.user._id.toString(),
          'Payout Failed',
          `Your payout of GHS ${payout.amount.toFixed(2)} failed. The amount has been returned to your earnings balance.`,
          'error',
          { type: 'payout_failed', payoutId: payout._id }
        );
      } catch (notifErr) {
        logger.warn('[Payout Webhook] Failed to notify agent', { message: notifErr.message });
      }
    }
  }

  async refundFailedPayout(payout) {
    // Use withTransaction so it gracefully falls back on standalone MongoDB (no replica set)
    return await this.withTransaction(async (session) => {
      const userId = payout.user?._id || payout.user;
      const updated = await User.findByIdAndUpdate(
        userId,
        { $inc: { earningsBalance: payout.amount } },
        session ? { session, new: true } : { new: true }
      );

      const txData = [{
        user: userId,
        type: 'credit',
        amount: payout.amount,
        balanceAfter: updated.earningsBalance,
        description: `Refund for failed payout #${payout._id}`,
        relatedPayout: payout._id,
        metadata: { reason: 'transfer_failed' },
      }];

      if (session) {
        await EarningsTransaction.create(txData, { session });
      } else {
        await EarningsTransaction.create(txData);
      }

      logger.info('[Payout] Refunded earnings', { payoutId: payout._id, amount: payout.amount });
    });
  }

  isValidGhanaPhone(phone) {
    const cleaned = String(phone).replace(/[\s\-()]/g, '');
    return /^0?[2-5]\d{8,9}$/.test(cleaned) || /^233[2-5]\d{8}$/.test(cleaned);
  }

  detectNetwork(phone) {
    const cleaned = String(phone).replace(/\D/g, '');
    const last9 = cleaned.slice(-9);
    const prefix = last9.slice(0, 2);
    if (['24', '54', '55', '59'].includes(prefix)) return 'MTN';
    if (['20', '50'].includes(prefix)) return 'VOD';
    if (['27', '57', '26', '56'].includes(prefix)) return 'ATL';
    return null;
  }

  async getEarningsDashboard(userId) {
    const user = await User.findById(userId).select('earningsBalance walletBalance');
    if (!user) throw new Error('User not found');

    const earnings = await EarningsTransaction.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          totalWithdrawn: { $sum: { $cond: [{ $eq: ['$type', 'payout'] }, { $abs: '$amount' }, 0] } },
        },
      },
    ]);

    const recentPayouts = await PayoutRequest.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Include fee info so frontend can display estimated costs
    const feeConfig = await getFeeConfig();
    const payoutSettings = await settingsService.getPayoutSettings();

    return {
      availableBalance: Number(user.earningsBalance) || 0,
      walletBalance: Number(user.walletBalance) || 0,
      totalEarned: earnings[0]?.totalEarned || 0,
      totalWithdrawn: Math.abs(earnings[0]?.totalWithdrawn || 0),
      recentPayouts,
      transferFees: {
        mobile_money: feeConfig.paystackTransferFees?.mobile_money ?? 1.0,
        bank_account: feeConfig.paystackTransferFees?.bank_account ?? 8.0,
      },
      payoutFeeBearer: feeConfig.payoutFeeBearer || 'agent',
      minimumPayoutAmounts: payoutSettings.minimumPayoutAmounts,
      canRequestPayout: (Number(user.earningsBalance) || 0) >= payoutSettings.minimumPayoutAmounts.mobile_money,
    };
  }

  async getPayoutsForUser(userId, filters = {}) {
    const query = { user: userId };
    if (filters.status) query.status = filters.status;
    const payouts = await PayoutRequest.find(query).sort({ createdAt: -1 }).limit(50).lean();
    return payouts;
  }

  async getPendingPayoutsForAdmin(filters = {}) {
    // By default return pending, but allow filtering for all actionable statuses
    const statusFilter = filters.status
      ? { status: filters.status }
      : { status: { $in: ['pending', 'approved', 'processing'] } };

    const payouts = await PayoutRequest.find(statusFilter)
      .populate('user', 'fullName email phone earningsBalance userType')
      .sort({ requestedAt: 1 })
      .lean();
    return payouts;
  }
}

export default new PayoutService();
