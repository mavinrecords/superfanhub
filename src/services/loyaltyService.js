/**
 * Loyalty Service
 * Manages points and rewards
 */

const { getDatabase } = require('../db/database');

// Points configuration
const POINTS_PER_DOLLAR = 10;
const REDEMPTION_RATE = 0.01; // $1 per 100 points
const TIERS = {
    bronze: { min: 0, multiplier: 1 },
    silver: { min: 1000, multiplier: 1.2 },
    gold: { min: 5000, multiplier: 1.5 },
    platinum: { min: 10000, multiplier: 2.0 }
};

/**
 * Get loyalty profile
 */
function getLoyaltyProfile(email) {
    const db = getDatabase();

    let profile = db.prepare('SELECT * FROM loyalty_points WHERE email = ?').get(email);

    if (!profile) {
        db.prepare('INSERT INTO loyalty_points (email) VALUES (?)').run(email);
        profile = { email, points: 0, lifetime_points: 0, tier: 'bronze' };
    }

    return profile;
}

/**
 * Earn points from transaction
 */
function earnPoints(email, amount, referenceId) {
    const db = getDatabase();
    const profile = getLoyaltyProfile(email);

    const tierConfig = TIERS[profile.tier] || TIERS.bronze;
    const pointsEarned = Math.floor(amount * POINTS_PER_DOLLAR * tierConfig.multiplier);

    db.transaction(() => {
        // Update points
        db.prepare(`
            UPDATE loyalty_points 
            SET points = points + ?, lifetime_points = lifetime_points + ?, updated_at = datetime('now')
            WHERE email = ?
        `).run(pointsEarned, pointsEarned, email);

        // Log transaction
        db.prepare(`
            INSERT INTO loyalty_transactions (email, amount, type, reference_id)
            VALUES (?, ?, 'earned', ?)
        `).run(email, pointsEarned, referenceId);

        // Check tier upgrade
        updateTier(email);
    })();

    return { pointsEarned, newBalance: profile.points + pointsEarned };
}

/**
 * Update tier based on lifetime points
 */
function updateTier(email) {
    const db = getDatabase();
    const profile = db.prepare('SELECT lifetime_points FROM loyalty_points WHERE email = ?').get(email);

    let newTier = 'bronze';
    for (const [tier, config] of Object.entries(TIERS)) {
        if (profile.lifetime_points >= config.min) {
            newTier = tier;
        }
    }

    db.prepare('UPDATE loyalty_points SET tier = ? WHERE email = ?').run(newTier, email);
}

/**
 * Get history
 */
function getHistory(email) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM loyalty_transactions WHERE email = ? ORDER BY created_at DESC LIMIT 50').all(email);
}

module.exports = {
    getLoyaltyProfile,
    earnPoints,
    getHistory,
    TIERS
};
