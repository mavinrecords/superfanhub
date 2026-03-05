/**
 * Contribution Service - Mavin Community Task Master
 * Calculate/update contribution scores, auto-promote fan tiers
 */

const { getDatabase, runTransaction } = require('../db/database');
const { eventBus } = require('./eventBusService');

const FAN_TIER_THRESHOLDS = {
    fan: 0,
    superfan: 500,
    elite: 2500,
    inner_circle: 10000
};

const TIER_ORDER = ['fan', 'superfan', 'elite', 'inner_circle'];

/**
 * Get contribution score for a user
 */
function getContributionScore(userId) {
    const db = getDatabase();
    let score = db.prepare('SELECT * FROM contribution_scores WHERE user_id = ?').get(userId);

    if (!score) {
        db.prepare("INSERT INTO contribution_scores (user_id) VALUES (?)").run(userId);
        score = db.prepare('SELECT * FROM contribution_scores WHERE user_id = ?').get(userId);
    }

    return {
        ...score,
        next_tier: getNextTier(score.current_tier),
        next_tier_threshold: getNextTierThreshold(score.current_tier),
        progress_to_next: getProgressToNextTier(score.total_score, score.current_tier)
    };
}

/**
 * Recalculate tier based on score
 */
function recalculateTier(userId) {
    const db = getDatabase();
    const score = db.prepare('SELECT * FROM contribution_scores WHERE user_id = ?').get(userId);
    if (!score) return null;

    const newTier = calculateTierFromScore(score.total_score);

    if (newTier !== score.current_tier) {
        return runTransaction(() => {
            db.prepare(`
                UPDATE contribution_scores 
                SET current_tier = ?, tier_updated_at = datetime('now'), updated_at = datetime('now')
                WHERE user_id = ?
            `).run(newTier, userId);

            // Log tier change
            db.prepare(`
                INSERT INTO fan_tier_history (user_id, old_tier, new_tier, trigger_reason, score_at_change)
                VALUES (?, ?, ?, 'auto_promotion', ?)
            `).run(userId, score.current_tier, newTier, score.total_score);

            eventBus.emitTierChanged(userId, {
                oldTier: score.current_tier,
                newTier,
                score: score.total_score
            });

            return { userId, oldTier: score.current_tier, newTier, score: score.total_score };
        });
    }

    return null;
}

/**
 * Recalculate tiers for all users
 */
function recalculateAllTiers() {
    const db = getDatabase();
    const users = db.prepare('SELECT user_id, total_score, current_tier FROM contribution_scores').all();
    let promotions = 0;

    for (const user of users) {
        const newTier = calculateTierFromScore(user.total_score);
        if (newTier !== user.current_tier) {
            db.prepare(`
                UPDATE contribution_scores 
                SET current_tier = ?, tier_updated_at = datetime('now'), updated_at = datetime('now')
                WHERE user_id = ?
            `).run(newTier, user.user_id);

            db.prepare(`
                INSERT INTO fan_tier_history (user_id, old_tier, new_tier, trigger_reason, score_at_change)
                VALUES (?, ?, ?, 'auto_promotion_batch', ?)
            `).run(user.user_id, user.current_tier, newTier, user.total_score);

            promotions++;
        }
    }

    return { processed: users.length, promotions };
}

/**
 * Get tier history for a user
 */
function getTierHistory(userId) {
    const db = getDatabase();
    return db.prepare(`
        SELECT * FROM fan_tier_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(userId);
}

// ─── HELPERS ────────────────────────────────────────────────

function calculateTierFromScore(totalScore) {
    if (totalScore >= FAN_TIER_THRESHOLDS.inner_circle) return 'inner_circle';
    if (totalScore >= FAN_TIER_THRESHOLDS.elite) return 'elite';
    if (totalScore >= FAN_TIER_THRESHOLDS.superfan) return 'superfan';
    return 'fan';
}

function getNextTier(currentTier) {
    const idx = TIER_ORDER.indexOf(currentTier);
    return idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

function getNextTierThreshold(currentTier) {
    const next = getNextTier(currentTier);
    return next ? FAN_TIER_THRESHOLDS[next] : null;
}

function getProgressToNextTier(totalScore, currentTier) {
    const nextThreshold = getNextTierThreshold(currentTier);
    if (!nextThreshold) return 100; // Already max tier
    const currentThreshold = FAN_TIER_THRESHOLDS[currentTier];
    const range = nextThreshold - currentThreshold;
    const progress = totalScore - currentThreshold;
    return Math.min(100, Math.round((progress / range) * 100));
}

module.exports = {
    getContributionScore,
    recalculateTier,
    recalculateAllTiers,
    getTierHistory,
    calculateTierFromScore,
    FAN_TIER_THRESHOLDS,
    TIER_ORDER
};
