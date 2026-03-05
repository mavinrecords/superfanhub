/**
 * Reward Catalog Service - Mavin Community Task Master
 * Reward CRUD, inventory, and redemption flow
 */

const { getDatabase, runTransaction } = require('../db/database');
const { deductPoints, getLoyaltyCard } = require('./loyaltyCardService');
const { getContributionScore } = require('./contributionService');

const TIER_ORDER = ['fan', 'superfan', 'elite', 'inner_circle'];

/**
 * Create a reward
 */
function createReward({
    title, description, category, pointsCost, tierRequired,
    inventory, imageUrl, artistId, artistName, redemptionInstructions
}) {
    const db = getDatabase();
    const result = db.prepare(`
        INSERT INTO rewards (title, description, category, points_cost, tier_required,
            inventory, image_url, artist_id, artist_name, is_active, redemption_instructions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
        title, description || '', category || 'general', pointsCost,
        tierRequired || 'fan', inventory ?? -1, imageUrl || null,
        artistId || null, artistName || null, redemptionInstructions || ''
    );

    return getRewardById(result.lastInsertRowid);
}

/**
 * Update a reward
 */
function updateReward(id, updates) {
    const db = getDatabase();
    const allowed = [
        'title', 'description', 'category', 'points_cost', 'tier_required',
        'inventory', 'image_url', 'artist_id', 'artist_name', 'is_active', 'redemption_instructions'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return getRewardById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE rewards SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getRewardById(id);
}

/**
 * Get reward by ID
 */
function getRewardById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM rewards WHERE id = ?').get(id);
}

/**
 * List rewards (catalog)
 */
function listRewards({ category, tierRequired, isActive = 1, limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    let query = 'SELECT * FROM rewards WHERE is_active = ?';
    const params = [isActive];

    if (category) { query += ' AND category = ?'; params.push(category); }
    if (tierRequired) { query += ' AND tier_required = ?'; params.push(tierRequired); }

    query += ' ORDER BY points_cost ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params);
}

/**
 * Redeem a reward
 */
function redeemReward(userId, rewardId) {
    const db = getDatabase();
    const reward = getRewardById(rewardId);

    if (!reward) throw new Error('Reward not found');
    if (!reward.is_active) throw new Error('Reward is no longer available');

    // Check inventory
    if (reward.inventory !== -1 && reward.inventory <= 0) {
        throw new Error('Reward is out of stock');
    }

    // Check user tier
    const contribution = getContributionScore(userId);
    const userTierIdx = TIER_ORDER.indexOf(contribution.current_tier);
    const requiredTierIdx = TIER_ORDER.indexOf(reward.tier_required);

    if (userTierIdx < requiredTierIdx) {
        throw new Error(`Requires ${reward.tier_required} tier or higher`);
    }

    // Check points balance
    const card = getLoyaltyCard(userId);
    if (!card || card.points < reward.points_cost) {
        throw new Error('Insufficient points');
    }

    return runTransaction(() => {
        // Deduct points
        deductPoints(userId, reward.points_cost, `Redeemed: ${reward.title}`);

        // Reduce inventory
        if (reward.inventory !== -1) {
            db.prepare('UPDATE rewards SET inventory = inventory - 1, updated_at = datetime(\'now\') WHERE id = ?')
                .run(rewardId);
        }

        // Create redemption record
        const result = db.prepare(`
            INSERT INTO reward_redemptions (user_id, reward_id, points_spent, status)
            VALUES (?, ?, ?, 'pending')
        `).run(userId, rewardId, reward.points_cost);

        return {
            success: true,
            redemptionId: result.lastInsertRowid,
            reward: reward.title,
            pointsSpent: reward.points_cost,
            instructions: reward.redemption_instructions
        };
    });
}

/**
 * Get user's redemption history
 */
function getUserRedemptions(userId, limit = 20) {
    const db = getDatabase();
    return db.prepare(`
        SELECT rr.*, r.title, r.category, r.image_url
        FROM reward_redemptions rr
        JOIN rewards r ON rr.reward_id = r.id
        WHERE rr.user_id = ?
        ORDER BY rr.created_at DESC LIMIT ?
    `).all(userId, limit);
}

/**
 * Update redemption status (admin)
 */
function updateRedemptionStatus(redemptionId, status, fulfillmentData = null) {
    const db = getDatabase();
    db.prepare(`
        UPDATE reward_redemptions SET status = ?, fulfillment_data = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(status, fulfillmentData, redemptionId);

    return db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(redemptionId);
}

/**
 * Get reward stats (admin)
 */
function getRewardStats() {
    const db = getDatabase();
    return db.prepare(`
        SELECT 
            (SELECT COUNT(*) FROM rewards WHERE is_active = 1) as active_rewards,
            (SELECT COUNT(*) FROM reward_redemptions) as total_redemptions,
            (SELECT SUM(points_spent) FROM reward_redemptions) as total_points_spent,
            (SELECT COUNT(*) FROM reward_redemptions WHERE status = 'pending') as pending_fulfillment
    `).get();
}

module.exports = {
    createReward, updateReward, getRewardById, listRewards,
    redeemReward, getUserRedemptions, updateRedemptionStatus,
    getRewardStats
};
