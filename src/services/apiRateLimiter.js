// src/services/apiRateLimiter.js
import logger from "../utils/logger.js";

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 2000;

class ApiRateLimiter {
  constructor() {
    this.store = new Map();
    this.cleanupInterval = setInterval(() => this._cleanup(), 60 * 1000);
    this._windowMs = DEFAULT_WINDOW_MS;
    this._defaultLimit = DEFAULT_LIMIT;
  }

  /** Update rate limit config at runtime. */
  updateConfig({ defaultLimit, windowMs }) {
    if (defaultLimit !== undefined) {
      if (!Number.isInteger(defaultLimit) || defaultLimit < 1 || defaultLimit > 100000) {
        throw new Error("defaultLimit must be an integer between 1 and 100000");
      }
      this._defaultLimit = defaultLimit;
    }
    if (windowMs !== undefined) {
      if (!Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 3600000) {
        throw new Error("windowMs must be between 1000 and 3600000");
      }
      this._windowMs = windowMs;
    }
  }

  /**
   * Check if a request is allowed under the rate limit.
   *
   * @param {string} key - The rate limit key (e.g. apiKeyId).
   * @param {number} limit - Max requests per window (defaults to configured default).
   * @returns {{ allowed: boolean, remaining: number, resetAt: Date }}
   */
  async checkRateLimit(key, limit) {
    const effectiveLimit = limit ?? this._defaultLimit;
    const now = Date.now();
    const windowStart = now - this._windowMs;

    if (!this.store.has(key)) {
      this.store.set(key, []);
    }

    const timestamps = this.store.get(key);

    const recent = timestamps.filter((t) => t > windowStart);
    this.store.set(key, recent);

    const remaining = Math.max(0, effectiveLimit - recent.length);
    const resetAt = new Date(
      recent.length > 0 ? recent[0] + this._windowMs : now + this._windowMs,
    );

    if (recent.length >= effectiveLimit) {
      logger.warn(`Rate limit exceeded for key ${key}`);
      return { allowed: false, remaining: 0, resetAt };
    }

    recent.push(now);
    this.store.set(key, recent);

    return { allowed: true, remaining: remaining - 1, resetAt };
  }

  _cleanup() {
    const cutoff = Date.now() - this._windowMs;
    for (const [key, timestamps] of this.store.entries()) {
      const recent = timestamps.filter((t) => t > cutoff);
      if (recent.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, recent);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

export default new ApiRateLimiter();
