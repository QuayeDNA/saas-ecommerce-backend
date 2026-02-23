// src/services/payoutService.js
import mongoose from 'mongoose';
import PayoutRequest from '../models/PayoutRequest.js';
import EarningsTransaction from '../models/EarningsTransaction.js';
import User from '../models/User.js';
import paystackService from './paystackService.js';
import notificationService from './notificationService.js';
import logger from '../utils/logger.js';

const MIN_PAYOUT_MOMO = 1;
const MIN_PAYOUT_BANK = 50;

class PayoutService {
  async requestPayout(userId, amount, destination) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      const balance = Number(user.earningsBalance) || 0;
      if (balance < amount) {
        throw new Error(`Insufficient earnings. Available: GHS ${balance.toFixed(2)}`);
      }

      const minPayout = destination.type === 'bank_account' ? MIN_PAYOUT_BANK : MIN_PAYOUT_MOMO;
      if (amount < minPayout) {
        throw new Error(`Minimum payout: GHS ${minPayout}`);
      }

      const existingPending = await PayoutRequest.findOne({
        user: userId,
        status: 'pending',
      }).session(session);

      if (existingPending) {
        throw new Error('You have a pending payout request. Please wait for it to be processed.');
      }

      await this.validateDestination(destination, user);

      const payout = new PayoutRequest({
        user: userId,
        amount,
        destination,
        requestedAt: new Date(),
      });
      await payout.save({ session });

      await session.commitTransaction();
      session.endSession();

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
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  async approvePayout(payoutId, adminId, transferReference = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const payout = await PayoutRequest.findById(payoutId).populate('user').session(session);
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
      await user.save({ session, validateBeforeSave: false });

      await EarningsTransaction.create(
        [
          {
            user: user._id,
            type: 'payout',
            amount: -payout.amount,
            balanceAfter: user.earningsBalance,
            description: `Payout request #${payout._id}`,
            relatedPayout: payout._id,
            metadata: { destination: payout.destination },
          },
        ],
        { session }
      );

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
      await payout.save({ session });

      await session.commitTransaction();
      session.endSession();

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
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
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

    let recipientCode = payout.destination?.recipientCode;
    if (!recipientCode) {
      recipientCode = await this.createPaystackRecipient(payout);
      payout.destination = payout.destination || {};
      payout.destination.recipientCode = recipientCode;
      await payout.save();
    }

    const transferRef = `payout_${payout._id}_${Date.now()}`;

    try {
      await paystackService.ensureKeys();
      const transfer = await paystackService.initiateTransfer({
        source: 'balance',
        amount: paystackService.convertToPesewas(payout.amount),
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
      payout.status = 'failed';
      payout.paystackTransfer = payout.paystackTransfer || {};
      payout.paystackTransfer.failureReason = err.message;
      await payout.save();
      logger.error('[Payout] Transfer failed', { payoutId, error: err.message });
      await this.refundFailedPayout(payout);
      throw err;
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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = payout.user?._id || payout.user;
      const updated = await User.findByIdAndUpdate(
        userId,
        { $inc: { earningsBalance: payout.amount } },
        { session, new: true }
      );

      await EarningsTransaction.create(
        [
          {
            user: userId,
            type: 'credit',
            amount: payout.amount,
            balanceAfter: updated.earningsBalance,
            description: `Refund for failed payout #${payout._id}`,
            relatedPayout: payout._id,
            metadata: { reason: 'transfer_failed' },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();
      logger.info('[Payout] Refunded earnings', { payoutId: payout._id, amount: payout.amount });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      logger.error('[Payout] Refund failed', { payoutId: payout._id, error: err.message });
      throw err;
    }
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

    return {
      availableBalance: Number(user.earningsBalance) || 0,
      walletBalance: Number(user.walletBalance) || 0,
      totalEarned: earnings[0]?.totalEarned || 0,
      totalWithdrawn: Math.abs(earnings[0]?.totalWithdrawn || 0),
      recentPayouts,
      canRequestPayout: (Number(user.earningsBalance) || 0) >= MIN_PAYOUT_MOMO,
    };
  }

  async getPayoutsForUser(userId, filters = {}) {
    const query = { user: userId };
    if (filters.status) query.status = filters.status;
    const payouts = await PayoutRequest.find(query).sort({ createdAt: -1 }).limit(50).lean();
    return payouts;
  }

  async getPendingPayoutsForAdmin() {
    const payouts = await PayoutRequest.find({ status: 'pending' })
      .populate('user', 'fullName email phone earningsBalance')
      .sort({ requestedAt: 1 })
      .lean();
    return payouts;
  }
}

export default new PayoutService();
