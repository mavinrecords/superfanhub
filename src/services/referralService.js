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

module.exports = {
    getReferralCode,
    processReferral,
    getReferralStats
};
