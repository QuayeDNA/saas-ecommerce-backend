// src/jobs/paystackVerificationRetry.js
import cron from "node-cron";
import paystackService from "../services/paystackService.js";
import storefrontService from "../services/storefrontService.js";
import walletService from "../services/walletService.js";
import Order from "../models/Order.js";
import PaystackVerificationTask from "../models/PaystackVerificationTask.js";
import logger from "../utils/logger.js";

// How often to retry failed / unverified Paystack transactions
const JOB_SCHEDULE = "*/5 * * * *"; // every 5 minutes
const MAX_ATTEMPTS = 12;

async function processTask(task) {
  const reference = task.reference;

  try {
    await paystackService.ensureKeys().catch(() => {});

    const paystackData = await paystackService.verifyTransaction(reference);
    if (!paystackData || paystackData.status !== "success") {
      const reason =
        paystackData?.message || "Paystack transaction not successful";
      logger.warn(
        `[PaystackVerificationJob] Reference ${reference} not successful: ${reason}`,
      );

      // Keep retrying for a while; eventually mark as failed to avoid infinite loops.
      if (task.attemptCount >= MAX_ATTEMPTS) {
        task.status = "failed";
        task.lastError = reason;
        await task.save();
        logger.warn(
          `[PaystackVerificationJob] Marked task failed after ${task.attemptCount} attempts: ${reference}`,
        );
      } else {
        task.status = "pending";
        task.lastError = reason;
        await task.save();
      }

      return;
    }

    // At this point we have a successful Paystack transaction. Process it.
    if (task.kind === "storefront") {
      try {
        const result =
          await storefrontService.processPaystackPayment(paystackData);
        // If result indicates duplicate, that's fine.
      } catch (err) {
        logger.error(
          `[PaystackVerificationJob] Error processing storefront payment for ${reference}: ${err.message}`,
        );
        throw err;
      }
    } else if (task.kind === "wallet") {
      try {
        await walletService.processPaystackWebhook({
          event: "charge.success",
          data: paystackData,
        });
      } catch (err) {
        logger.error(
          `[PaystackVerificationJob] Error processing wallet top-up for ${reference}: ${err.message}`,
        );
        throw err;
      }
    }

    task.status = "done";
    task.lastError = null;
    await task.save();
    logger.info(
      `[PaystackVerificationJob] Successfully processed Paystack reference ${reference}`,
    );
  } catch (err) {
    const message = err?.message || "unknown error";
    const paystackMessage =
      err?.paystackResponse?.message ||
      err?.paystackResponse?.data?.message ||
      "";
    const combinedMessage = [message, paystackMessage]
      .filter(Boolean)
      .join(" | ");
    const isNotFound = /transaction not found/i.test(combinedMessage);

    if (isNotFound) {
      task.status = "failed";
      task.lastError = combinedMessage;
      await task.save();
      logger.warn(
        `[PaystackVerificationJob] Marked task failed (transaction not found): ${reference}`,
      );
      return;
    }

    // Transient error: keep pending for retry
    task.lastError = combinedMessage;
    task.status = task.attemptCount >= MAX_ATTEMPTS ? "failed" : "pending";
    await task.save();
    logger.error(
      `[PaystackVerificationJob] Error processing task ${reference}: ${message}`,
    );
  }
}

function schedulePaystackVerificationRetryJob() {
  cron.schedule(
    JOB_SCHEDULE,
    async () => {
      logger.info("=== Paystack verification retry job started ===");
      try {
        // Seed tasks for any storefront orders that are stuck in pending_payment
        // (e.g. payment succeeded but verification endpoint call failed).
        const strandedOrders = await Order.find({
          orderType: "storefront",
          status: "pending_payment",
          "storefrontData.paymentMethod.type": "paystack",
        })
          .limit(50)
          .lean();
        for (const order of strandedOrders) {
          try {
            await PaystackVerificationTask.updateOne(
              { reference: `storefront_${order._id}` },
              {
                $setOnInsert: {
                  kind: "storefront",
                  orderId: order._id,
                },
              },
              { upsert: true },
            );
          } catch (err) {
            // ignore duplicates or other transient issues
          }
        }

        // Find tasks still pending (or failed but under max attempts) and not currently processing.
        const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
        const tasks = await PaystackVerificationTask.find({
          status: { $in: ["pending", "processing"] },
          attemptCount: { $lt: MAX_ATTEMPTS },
          $or: [
            { lastAttemptAt: { $exists: false } },
            { lastAttemptAt: { $lt: cutoff } },
          ],
        })
          .limit(20)
          .lean();

        for (const t of tasks) {
          try {
            // Atomically claim the task for processing
            const claimed = await PaystackVerificationTask.findOneAndUpdate(
              { _id: t._id, status: t.status },
              {
                status: "processing",
                $inc: { attemptCount: 1 },
                lastAttemptAt: new Date(),
              },
              { new: true },
            );
            if (!claimed) continue;
            await processTask(claimed);
          } catch (err) {
            logger.error(
              `[PaystackVerificationJob] Failed to claim/process task ${t._id}: ${err.message}`,
            );
          }
        }
      } catch (err) {
        logger.error(`[PaystackVerificationJob] Job failed: ${err.message}`);
      }
      logger.info("=== Paystack verification retry job completed ===");
    },
    {
      scheduled: true,
      timezone: "Africa/Accra",
    },
  );
}

export { schedulePaystackVerificationRetryJob };
export default schedulePaystackVerificationRetryJob;
