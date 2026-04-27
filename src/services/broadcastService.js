/**
 * Broadcast Service - Mavin SuperFan Hub
 *
 * Admin email broadcasts. Iterates the recipient set in batches and
 * relies on emailService.sendEmail() for the actual SMTP transport.
 *
 * Audience selectors:
 *   'all'              — every user in the users table (excluding suspended)
 *   'tier:fan'         — users currently at fan tier
 *   'tier:superfan'    — users at superfan tier
 *   'tier:elite'       — users at elite tier
 *   'tier:inner_circle'— users at inner_circle tier
 *   'verified'         — only is_verified = 1
 *
 * Rate limiting: 50ms delay between sends keeps SMTP providers happy
 * (~20 emails/sec ceiling). For 1000 recipients that's ~50 seconds,
 * which is well under the typical Express request timeout. Larger
 * audiences should use the 'preview' endpoint and a background worker
 * (out of scope for this tier).
 */

const { getDatabase } = require('../db/database');
const { sendEmail } = require('./emailService');

const VALID_TIERS = ['fan', 'superfan', 'elite', 'inner_circle'];

/**
 * Resolve the audience selector to a list of {email, name} rows.
 * Suspended users are always excluded — they shouldn't get marketing
 * blasts while their account is locked.
 */
function resolveAudience(audience) {
    const db = getDatabase();

    if (!audience || audience === 'all') {
        return db.prepare(`
            SELECT id, email, name FROM users
            WHERE is_suspended = 0 AND email IS NOT NULL AND email != ''
        `).all();
    }

    if (audience === 'verified') {
        return db.prepare(`
            SELECT id, email, name FROM users
            WHERE is_suspended = 0 AND is_verified = 1 AND email IS NOT NULL AND email != ''
        `).all();
    }

    if (audience.startsWith('tier:')) {
        const tier = audience.slice('tier:'.length);
        if (!VALID_TIERS.includes(tier)) {
            throw new Error(`Invalid tier: ${tier}. Allowed: ${VALID_TIERS.join(', ')}`);
        }
        // contribution_scores stores the user's current tier
        return db.prepare(`
            SELECT u.id, u.email, u.name
            FROM users u
            JOIN contribution_scores cs ON cs.user_id = u.id
            WHERE u.is_suspended = 0
              AND u.email IS NOT NULL AND u.email != ''
              AND cs.current_tier = ?
        `).all(tier);
    }

    throw new Error(`Unknown audience selector: ${audience}`);
}

/**
 * Preview a broadcast — returns recipient count + first 5 emails
 * without sending anything. Caller should always call this before
 * triggering the actual send.
 */
function previewBroadcast({ audience }) {
    const recipients = resolveAudience(audience);
    return {
        audience,
        count: recipients.length,
        sample: recipients.slice(0, 5).map(r => ({ email: r.email, name: r.name }))
    };
}

/**
 * Wrap the body in a minimal HTML shell so plain-text bodies render
 * cleanly across mail clients. If body already starts with <!DOCTYPE
 * or <html, pass-through unchanged.
 */
function wrapBody(subject, body) {
    const trimmed = String(body || '').trim();
    if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;

    // Convert plain newlines to <br> for plain-text bodies.
    const htmlBody = String(body || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Segoe UI,Tahoma,sans-serif;background:#0a0a0a;color:#fff;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#111;padding:32px;border-radius:12px;border:1px solid #222;">
    <h2 style="color:#10b981;margin-top:0;">${escapeHtml(subject)}</h2>
    <div style="line-height:1.6;color:#eee;">${htmlBody}</div>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0 16px 0;">
    <p style="font-size:12px;color:#666;">You're receiving this because you're a member of the Mavin SuperFan Hub.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * Send the broadcast. Returns a summary including per-recipient outcomes.
 *
 * @param {object} args
 * @param {string} args.subject  - Email subject
 * @param {string} args.body     - Email body (HTML or plain text)
 * @param {string} args.audience - One of 'all', 'verified', 'tier:<tier>'
 * @param {number} [args.delayMs=50] - Inter-send delay
 */
async function broadcastEmail({ subject, body, audience, delayMs = 50 }) {
    if (!subject || !subject.trim()) throw new Error('subject is required');
    if (!body || !body.trim()) throw new Error('body is required');

    const recipients = resolveAudience(audience);
    if (recipients.length === 0) {
        return { audience, sent: 0, failed: 0, recipients: 0, results: [] };
    }

    const html = wrapBody(subject, body);
    const results = [];
    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
        try {
            const result = await sendEmail({ to: r.email, subject, html });
            if (result.sent) {
                sent += 1;
                results.push({ email: r.email, ok: true });
            } else {
                failed += 1;
                results.push({ email: r.email, ok: false, error: result.reason || result.error || 'unknown' });
            }
        } catch (e) {
            failed += 1;
            results.push({ email: r.email, ok: false, error: e.message });
        }
        // Crude rate limiter — keeps SMTP providers happy.
        if (delayMs > 0 && sent + failed < recipients.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return {
        audience,
        recipients: recipients.length,
        sent,
        failed,
        // Don't return per-recipient results to the route by default — the
        // payload could be huge. Caller can opt-in.
        results
    };
}

module.exports = {
    resolveAudience,
    previewBroadcast,
    broadcastEmail,
    VALID_TIERS
};
