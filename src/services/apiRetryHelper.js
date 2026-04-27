// Shared retry helper for external API calls.
// Extracted from spotifyService.js's original pathfixRequest so both the direct
// Spotify integration and the YouTube (Phase 2) integration can share the same
// 429-handling + exponential-backoff logic.
//
// Usage:
//   const { fetchWithRetry } = require('./apiRetryHelper');
//   const res = await fetchWithRetry(url, fetchOptions, { label: 'spotify' });
//   // res is a standard Response — caller handles .json() / status codes.
//
// The helper only retries on HTTP 429 (Too Many Requests). Everything else is
// returned to the caller as-is. Caller is responsible for handling 4xx/5xx
// semantics specific to their API.

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_WAIT_MS = 30_000;

/**
 * fetch() with automatic retry on 429 responses.
 *
 * Backoff rules:
 *   - Honor the `Retry-After` header if the server sent one (interpreted as seconds).
 *   - Otherwise, exponential fallback: 2s, 4s, 6s (scaled by retry count).
 *   - Always clamped to [1s, maxWaitMs].
 *
 * @param {string} url               Fully-qualified URL.
 * @param {object} [options]         Standard fetch() options.
 * @param {object} [cfg]
 * @param {number} [cfg.maxRetries=3]
 * @param {number} [cfg.maxWaitMs=30000]
 * @param {string} [cfg.label='api'] Used in log messages + thrown error text.
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, {
    maxRetries = DEFAULT_MAX_RETRIES,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    label = 'api'
} = {}) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const res = await fetch(url, options);
        if (res.status !== 429) return res;

        if (attempt >= maxRetries) {
            throw new Error(`${label} rate limit exceeded after ${maxRetries} retries`);
        }

        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        const waitMs = Math.min(
            maxWaitMs,
            Math.max(1000, retryAfterSec * 1000 || 2000 * (attempt + 1))
        );
        console.warn(`[${label}] 429 → waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
    }
}

module.exports = { fetchWithRetry, DEFAULT_MAX_RETRIES, DEFAULT_MAX_WAIT_MS };
