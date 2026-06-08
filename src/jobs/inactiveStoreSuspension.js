// src/jobs/inactiveStoreSuspension.js

/**
 * Inactive Store Suspension Job
 *
 * Automatically suspends storefronts that have had no activity within the
 * configured threshold (default 14 days). Activity is tracked via the
 * `lastActivityAt` field on AgentStorefront — updated whenever an order
 * is placed or the storefront is edited.
 *
 * Suspended stores are visible to the agent but cannot be interacted with.
 * The agent must contact the admin to restore access.
 *
 * Configuration (via Settings singleton):
 * - autoSuspendInactiveStores (boolean) — master toggle for this job
 * - inactivityThresholdDays (number) — days of inactivity before suspension (default: 14)
 */

import cron from "node-cron";
import AgentStorefront from "../models/AgentStorefront.js";
import Settings from "../models/Settings.js";
import notificationService from "../services/notificationService.js";
import logger from "../utils/logger.js";

const SUSPENSION_REASON =
  "Automatically suspended due to inactivity — contact admin to restore access";

/**
 * Core job logic — finds inactive stores and suspends them.
 * Returns a summary of what was done.
 */
export async function runInactiveStoreSuspensionJob() {
  try {
    const settings = await Settings.getInstance();

    if (!settings.autoSuspendInactiveStores) {
      return { skipped: true, reason: "autoSuspendInactiveStores is disabled" };
    }

    const thresholdDays = settings.inactivityThresholdDays || 14;
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    // Find active, approved, non-suspended storefronts with no recent activity.
    // If lastActivityAt is null, fall back to createdAt (never had any activity).
    const inactiveStores = await AgentStorefront.find({
      isActive: true,
      isApproved: true,
      suspendedByAdmin: { $ne: true },
      $or: [
        { lastActivityAt: { $lt: cutoff } },
        { lastActivityAt: null, createdAt: { $lt: cutoff } },
      ],
    }).populate("agentId", "fullName");

    if (inactiveStores.length === 0) {
      return { suspended: 0, skipped: 0, thresholdDays };
    }

    let suspended = 0;
    let skipped = 0;

    for (const store of inactiveStores) {
      try {
        store.isActive = false;
        store.suspendedByAdmin = true;
        store.suspensionReason = SUSPENSION_REASON;
        store.suspendedAt = new Date();
        // suspendedBy is left null to distinguish from admin-initiated suspensions
        await store.save();

        suspended++;

        // Notify the agent
        try {
          const agentId =
            store.agentId?._id?.toString() || store.agentId?.toString();
          if (agentId) {
            await notificationService.createInAppNotification(
              agentId,
              "Storefront Suspended — Inactivity",
              `Your storefront "${store.displayName}" has been automatically suspended due to inactivity (no activity in ${thresholdDays} days). Contact the admin to restore access.`,
              "warning",
              { type: "storefront_suspended_inactive", storefrontId: store._id },
            );
          }
        } catch (notifErr) {
          logger.error(
            `[InactiveStoreSuspension] Notification failed for store ${store._id}:`,
            notifErr,
          );
        }

        logger.info(
          `[InactiveStoreSuspension] Suspended store "${store.displayName}" (${store._id}) — last activity: ${store.lastActivityAt || store.createdAt}`,
        );
      } catch (err) {
        skipped++;
        logger.error(
          `[InactiveStoreSuspension] Failed to suspend store ${store._id}:`,
          err,
        );
      }
    }

    logger.info(
      `[InactiveStoreSuspension] Job complete — ${suspended} suspended, ${skipped} skipped, threshold: ${thresholdDays} days`,
    );

    return { suspended, skipped, thresholdDays };
  } catch (error) {
    logger.error(`[InactiveStoreSuspension] Job failed: ${error.message}`);
    return { suspended: 0, skipped: 0, error: error.message };
  }
}

/**
 * Initialize the cron job.
 * Runs daily at 3:00 AM (Africa/Accra) — same window as daily commission processing.
 */
export function scheduleInactiveStoreSuspension() {
  cron.schedule(
    "0 3 * * *",
    async () => {
      logger.info("[InactiveStoreSuspension] Running inactive store suspension job");
      await runInactiveStoreSuspensionJob();
    },
    {
      scheduled: true,
      timezone: "Africa/Accra",
    },
  );

  logger.info(
    "[InactiveStoreSuspension] Cron job scheduled — runs daily at 03:00 Africa/Accra",
  );
}
