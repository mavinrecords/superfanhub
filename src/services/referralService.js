/**
 * Referral Service
 * Manages referral codes and rewards
 */

const { getDatabase } = require('../db/database');
const crypto = require('crypto');

/**
 * Generate unique referral code
 */
function generateReferralCode(email) {
    const hash = crypto.createHash('md5').update(email).digest('hex');
    return hash.substring(0, 8).toUpperCase();
}

/**
 * Get or create referral code for user
 */
function getReferralCode(email) {
    const db = getDatabase();

    let referral = db.prepare('SELECT code FROM referrals WHERE referrer_email = ?').get(email);

    if (!referral) {
        const code = generateReferralCode(email);
        try {
            db.prepare(`
                INSERT INTO referrals (referrer_email, code, status)
                VALUES (?, ?, 'active')
            `).run(email, code);
            return { code, isNew: true };
        } catch (e) {
            // Handle collision
            return { code: generateReferralCode(email + Date.now()), isNew: true };
        }
    }

    return { code: referral.code, isNew: false };
}

/**
 * Process referral usage
 */
function processReferral(code, refereeEmail) {
    const db = getDatabase();

    const referrer = db.prepare('SELECT * FROM referrals WHERE code = ?').get(code);
    if (!referrer) return { valid: false, error: 'Invalid code' };

    if (referrer.referrer_email === refereeEmail) {
        return { valid: false, error: 'Cannot refer yourself' };
    }

    // Check if referee already used a code
    const used = db.prepare('SELECT id FROM referrals WHERE referee_email = ?').get(refereeEmail);
    if (used) return { valid: false, error: 'Already referred' };

    // Record referral
    db.prepare(`
        INSERT INTO referrals (referrer_email, referee_email, code, status, created_at)
        VALUES (?, ?, ?, 'completed', datetime('now'))
    `).run(referrer.referrer_email, refereeEmail, code);

    // Award points to referrer (e.g. 500 points)
    const loyaltyService = require('./loyaltyService');
    loyaltyService.earnPoints(referrer.referrer_email, 50, 'Referral Bonus'); // $50 equivalent points

    return { valid: true, referrer: referrer.referrer_email };
}

/**
 * Get referral stats
 */
function getReferralStats(email) {
    const db = getDatabase();
    const stats = db.prepare(`
        SELECT COUNT(*) as count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM referrals
        WHERE referrer_email = ? AND referee_email IS NOT NULL
    `).get(email);

    return stats;
}

/**
 * List all referrals (admin). Excludes the seed rows that only carry a
 * referrer's own code (referee_email IS NULL) — those aren't actual referrals.
 * Joins users by email so admins see names where available.
 */
function listReferrals({ status, limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    let query = `
        SELECT r.id, r.referrer_email, r.referee_email, r.code, r.status,
               r.reward_status, r.created_at, r.completed_at,
               ru.name as referrer_name, eu.name as referee_name
        FROM referrals r
        LEFT JOIN users ru ON ru.email = r.referrer_email
        LEFT JOIN users eu ON eu.email = r.referee_email
        WHERE r.referee_email IS NOT NULL
    `;
    const params = [];
    if (status) { query += ' AND r.status = ?'; params.push(status); }
    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(query).all(...params);
}

/**
 * Manually approve a referral (admin). Marks status=completed, sets
 * completed_at if missing, awards reward points to the referrer if not yet
 * granted (via reward_status flag), and returns the updated row.
 *
 * Idempotent: re-running on an already-rewarded row is a no-op aside from
 * status=completed.
 */
function approveReferral(id) {
    const db = getDatabase();
    const referral = db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
    if (!referral) throw new Error('Referral not found');
    if (!referral.referee_email) throw new Error('Cannot approve a referral without a referee');

    db.prepare(`
        UPDATE referrals
        SET status = 'completed',
            completed_at = COALESCE(completed_at, datetime('now'))
        WHERE id = ?
    `).run(id);

    // Award points exactly once
    if (referral.reward_status !== 'granted') {
        try {
            // Look up referrer's user_id; loyalty system is keyed by user_id.
            const referrerUser = db.prepare('SELECT id FROM users WHERE email = ?').get(referral.referrer_email);
            if (referrerUser) {
                const { addPoints } = require('./loyaltyCardService');
                addPoints(referrerUser.id, 500, `Referral reward (manual approval): ${referral.referee_email}`, 'referral');
            }
            db.prepare(`UPDATE referrals SET reward_status = 'granted' WHERE id = ?`).run(id);
        } catch (e) {
            console.error('Referral reward grant error:', e);
            // Don't fail the approval — admin can re-issue points manually if needed.
        }
    }

    return db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
}

module.exports = {
    getReferralCode,
    processReferral,
    getReferralStats,
    listReferrals,
    approveReferral
};
