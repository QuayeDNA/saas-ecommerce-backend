import paystackService from '../services/paystackService.js';
import walletService from '../services/walletService.js';
import storefrontService from '../services/storefrontService.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Order from '../models/Order.js';
import logger from '../utils/logger.js';

class PaystackController {
  async handleWebhook(req, res) {
    try {
      // Ensure Paystack secret is loaded (may be stored in Settings)
      if (typeof paystackService.ensureKeys === 'function') {
        try {
          await paystackService.ensureKeys();
        } catch (keyErr) {
          logger.warn('[Paystack Webhook] ensureKeys failed', { message: keyErr.message });
        }
      }

      const rawBody = req.rawBody || '';
      const signature = req.headers['x-paystack-signature'];

      if (!signature) {
        logger.warn('[Paystack Webhook] missing signature');
        return res.status(400).json({ error: 'Missing signature' });
      }

      if (!paystackService.verifyWebhookSignature(rawBody, signature)) {
        logger.error('[Paystack Webhook] invalid signature');
        // If Paystack secret isn't configured, log more context
        if (!paystackService.isConfigured()) {
          logger.error('[Paystack Webhook] secret key not configured - webhook cannot be verified');
        }
        return res.status(400).json({ error: 'Invalid signature' });
      }

      const event = req.body;
      logger.info('[Paystack Webhook] event received', { event: event.event, reference: event.data?.reference });

      switch (event.event) {
        case 'charge.success':
          await this.handleChargeSuccess(event);
          break;
        case 'charge.failed':
          await this.handleChargeFailed(event);
          break;
        default:
          logger.info('[Paystack Webhook] unhandled event', { event: event.event });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error('[Paystack Webhook] processing error', { message: err.message, stack: err.stack });
      // Return 200 to avoid retry storms, but log the error for investigation
      return res.status(200).json({ received: true, error: err.message });
    }
  }

  async handleChargeSuccess(event) {
    const { data } = event;
    const metadata = data.metadata || {};

    // wallet top-up
    if (metadata.type === 'wallet_topup') {
      await walletService.processPaystackWebhook(event);
      return;
    }

    // storefront order - metadata.orderId expected
    if (metadata.orderId) {
      await storefrontService.processPaystackOrderWebhook(event);
      return;
    }

    logger.warn('[Paystack Webhook] charge.success with unknown metadata', { reference: data.reference });
  }

  async handleChargeFailed(event) {
    const { data } = event;
    const metadata = data.metadata || {};

    logger.info('[Paystack Webhook] charge.failed', { reference: data.reference, reason: data.gateway_response });

    if (metadata.type === 'wallet_topup') {
      // Match pending OR processing transactions so we don't miss ones currently being claimed
      const tx = await WalletTransaction.findOne({ reference: data.reference, status: { $in: ['pending', 'processing'] } });
      if (tx) {
        tx.status = 'rejected';
        tx.description = `${tx.description} - Payment failed: ${data.gateway_response}`;
        tx.metadata = tx.metadata || {};
        tx.metadata.paystack = tx.metadata.paystack || {};
        tx.metadata.paystack.failedAt = new Date();
        tx.metadata.paystack.failureReason = data.gateway_response;
        await tx.save();
      }
      return;
    }

    if (metadata.orderId) {
      const order = await Order.findById(metadata.orderId);
      if (order) {
        order.storefrontData.paymentMethod.verified = false;
        order.storefrontData.paymentMethod.verificationNotes = `Payment failed: ${data.gateway_response}`;
        order.metadata = order.metadata || {};
        order.metadata.paystackFailure = { reference: data.reference, reason: data.gateway_response, failedAt: new Date() };
        await order.save();
      }
      return;
    }
  }
}

export default new PaystackController();
