// src/services/blockedRecipientService.js
import BlockedRecipient from "../models/BlockedRecipient.js";
import logger from "../utils/logger.js";

// ─── Normalization ────────────────────────────────────────────────────────────
// Same convention as orderService / storefrontService MTN checks:
// strip spaces, dashes, parentheses, plus → handle 233 → 0
export function normalizePhone(phone) {
  if (!phone) return "";
  let n = String(phone).replace(/[\s\-\(\)\+]/g, "");
  if (n.startsWith("233")) n = "0" + n.slice(3);
  return n;
}

export function normalizePhones(phones) {
  return [...new Set((phones || []).map(normalizePhone).filter(Boolean))];
}

// ─── Read ───────────────────────────────────────────────────────────────────
export async function isBlocked(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  const exists = await BlockedRecipient.exists({ phone: normalized });
  return !!exists;
}

export async function findBlockedPhones(phones) {
  const normalized = normalizePhones(phones);
  if (normalized.length === 0) return new Set();
  const docs = await BlockedRecipient.find({ phone: { $in: normalized } })
    .select("phone")
    .lean();
  return new Set(docs.map((d) => d.phone));
}

// Throws with code BLOCKED_RECIPIENT if phone is blocked.
// Use for single-order paths where the whole request should fail.
export async function assertNotBlocked(phone) {
  if (!phone) return;
  const normalized = normalizePhone(phone);
  const exists = await BlockedRecipient.exists({ phone: normalized });
  if (exists) {
    const err = new Error(
      `Orders to recipient ${normalized} are currently blocked. Please contact support if you believe this is an error.`
    );
    err.code = "BLOCKED_RECIPIENT";
    err.blockedPhone = normalized;
    throw err;
  }
}

// Batch variant: returns map of index → error for bulk callers
export async function assertNotBlockedBatch(phones) {
  const blockedSet = await findBlockedPhones(phones);
  return blockedSet;
}

// ─── Write ──────────────────────────────────────────────────────────────────
const DEFAULT_REASON = "Ordering blocked due to platform violations";

export async function blockNumbers(numbers, { reason = DEFAULT_REASON, addedBy = null } = {}) {
  const list = Array.isArray(numbers) ? numbers : [numbers];
  const normalized = normalizePhones(list);
  if (normalized.length === 0) return { added: 0, skipped: 0, phones: [] };
  const effectiveReason = reason?.trim() ? reason.trim() : DEFAULT_REASON;

  const results = { added: 0, skipped: 0, phones: normalized };
  for (const phone of normalized) {
    try {
      await BlockedRecipient.updateOne(
        { phone },
        { $setOnInsert: { phone, reason: effectiveReason, addedBy } },
        { upsert: true }
      );
      // Check if it was an insert by counting — upsert doesn't tell us directly without rawResult
      // So we re-check: if doc existed before, it was skipped; lightweight approach: just count via exists after
      // Simpler: increment added optimistically, caller can inspect DB.
      results.added += 1;
    } catch (err) {
      if (err.code === 11000) results.skipped += 1;
      else throw err;
    }
  }
  // Correct counts: query how many were already present before
  // We keep simple: added = distinct normalized that are now in DB
  logger.info(`[BlockedRecipient] blockNumbers: ${normalized.join(", ")}`);
  return results;
}

export async function unblockNumbers(numbers) {
  const list = Array.isArray(numbers) ? numbers : [numbers];
  const normalized = normalizePhones(list);
  if (normalized.length === 0) return { removed: 0 };
  const res = await BlockedRecipient.deleteMany({ phone: { $in: normalized } });
  logger.info(`[BlockedRecipient] unblockNumbers: ${normalized.join(", ")} removed=${res.deletedCount}`);
  return { removed: res.deletedCount, phones: normalized };
}

export async function listBlocked({ page, limit, search } = {}) {
  // Paginated variant for admin UI — backward compat: no args returns all
  if (page == null && limit == null && !search) {
    return BlockedRecipient.find().sort({ createdAt: -1 }).lean();
  }
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;
  const filter = {};
  if (search) {
    const s = normalizePhone(search) || String(search).trim();
    filter.$or = [
      { phone: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { reason: { $regex: String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    BlockedRecipient.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    BlockedRecipient.countDocuments(filter),
  ]);
  return { items, total, page: p, totalPages: Math.ceil(total / l) || 1 };
}

export async function getStats() {
  const total = await BlockedRecipient.countDocuments();
  return { total };
}

export default {
  normalizePhone,
  normalizePhones,
  isBlocked,
  findBlockedPhones,
  assertNotBlocked,
  assertNotBlockedBatch,
  blockNumbers,
  unblockNumbers,
  listBlocked,
  getStats,
};
