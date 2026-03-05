// Loyalty Card Service - Mavin SuperFan Hub
// Manages loyalty card applications, tiers, and points

const crypto = require('crypto');
const { getDatabase } = require('../db/database');

const TIER_THRESHOLDS = {
    bronze: 0,
    silver: 1000,
    gold: 5000,
    platinum: 15000,
    diamond: 50000
};

/**
 * Apply for a new loyalty card
 */
function applyForCard(userId) {
    const db = getDatabase();

    // Check if user already has a card or pending application
    const existingCard = db.prepare('SELECT id FROM loyalty_cards WHERE user_id = ?').get(userId);
    if (existingCard) {
        throw new Error('You already have a loyalty card');
    }

    const pendingApp = db.prepare("SELECT id FROM loyalty_applications WHERE user_id = ? AND status = 'pending'").get(userId);
    if (pendingApp) {
        throw new Error('You already have a pending application');
    }

    // Create application
    const stmt = db.prepare(`
        INSERT INTO loyalty_applications (user_id, status, created_at)
        VALUES (?, 'pending', datetime('now'))
    `);

    const result = stmt.run(userId);

    // Auto-approve for now (can add manual approval later)
    return autoApproveApplication(result.lastInsertRowid);
}

/**
 * Auto-approve application and create card
 */
function autoApproveApplication(applicationId) {
    const db = getDatabase();

    const app = db.prepare('SELECT * FROM loyalty_applications WHERE id = ?').get(applicationId);
    if (!app) {
        throw new Error('Application not found');
    }

    // Generate unique card number
    const cardNumber = generateCardNumber();

    // Create the loyalty card
    db.prepare(`
        INSERT INTO loyalty_cards (user_id, card_number, tier, points, lifetime_points, status, issued_at, created_at)
        VALUES (?, ?, 'bronze', 100, 100, 'active', datetime('now'), datetime('now'))
    `).run(app.user_id, cardNumber);

    // Update application status
    db.prepare(`
        UPDATE loyalty_applications SET status = 'approved', reviewed_at = datetime('now')
        WHERE id = ?
    `).run(applicationId);

    // Award welcome bonus
    addPoints(app.user_id, 100, 'Welcome bonus', 'bonus');

    return getLoyaltyCard(app.user_id);
}

/**
 * Generate unique card number
 */
function generateCardNumber() {
    const prefix = 'MVN';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${timestamp.slice(-4)}-${random.slice(0, 4)}-${random.slice(4, 8)}`;
}

/**
 * Get loyalty card for user
 */
function getLoyaltyCard(userId) {
    const db = getDatabase();

    const card = db.prepare(`
        SELECT lc.*, u.name, u.email
        FROM loyalty_cards lc
        JOIN users u ON lc.user_id = u.id
        WHERE lc.user_id = ?
    `).get(userId);

    if (!card) return null;

    return {
        id: card.id,
        cardNumber: card.card_number,
        tier: card.tier,
        points: card.points,
        lifetimePoints: card.lifetime_points,
        status: card.status,
        issuedAt: card.issued_at,
        createdAt: card.created_at,
        user: {
            name: card.name,
            email: card.email
        }
    };
}

/**
 * Add points to user's card
 */
function addPoints(userId, amount, description, type = 'earned') {
    const db = getDatabase();

    const card = db.prepare('SELECT id, points, lifetime_points FROM loyalty_cards WHERE user_id = ?').get(userId);

    if (!card) {
        throw new Error('Loyalty card not found');
    }

    const newPoints = card.points + amount;
    const newLifetime = card.lifetime_points + amount;

    // Update card
    db.prepare(`
        UPDATE loyalty_cards 
        SET points = ?, lifetime_points = ?, tier = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(newPoints, newLifetime, calculateTier(newLifetime), card.id);

    // Log transaction
    db.prepare(`
        INSERT INTO loyalty_transactions (email, amount, type, reference_id, created_at)
        VALUES ((SELECT email FROM users WHERE id = ?), ?, ?, ?, datetime('now'))
    `).run(userId, amount, type, description);

    return { newBalance: newPoints, tier: calculateTier(newLifetime) };
}

/**
 * Deduct points from user's card
 */
function deductPoints(userId, amount, description) {
    const db = getDatabase();

    const card = db.prepare('SELECT id, points FROM loyalty_cards WHERE user_id = ?').get(userId);

    if (!card) {
        throw new Error('Loyalty card not found');
    }

    if (card.points < amount) {
        throw new Error('Insufficient points');
    }

    const newPoints = card.points - amount;

    db.prepare(`
        UPDATE loyalty_cards 
        SET points = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(newPoints, card.id);

    // Log transaction
    db.prepare(`
        INSERT INTO loyalty_transactions (email, amount, type, reference_id, created_at)
        VALUES ((SELECT email FROM users WHERE id = ?), ?, 'redeemed', ?, datetime('now'))
    `).run(userId, -amount, description);

    return { newBalance: newPoints };
}

/**
 * Calculate tier based on lifetime points
 */
function calculateTier(lifetimePoints) {
    if (lifetimePoints >= TIER_THRESHOLDS.diamond) return 'diamond';
    if (lifetimePoints >= TIER_THRESHOLDS.platinum) return 'platinum';
    if (lifetimePoints >= TIER_THRESHOLDS.gold) return 'gold';
    if (lifetimePoints >= TIER_THRESHOLDS.silver) return 'silver';
    return 'bronze';
}

/**
 * Get points transaction history
 */
function getPointsHistory(userId, limit = 20) {
    const db = getDatabase();

    const transactions = db.prepare(`
        SELECT lt.* FROM loyalty_transactions lt
        JOIN users u ON lt.email = u.email
        WHERE u.id = ?
        ORDER BY lt.created_at DESC
        LIMIT ?
    `).all(userId, limit);

    return transactions;
}

/**
 * Get leaderboard
 */
function getLeaderboard(limit = 10) {
    const db = getDatabase();

    return db.prepare(`
        SELECT lc.card_number, lc.tier, lc.lifetime_points, u.name
        FROM loyalty_cards lc
        JOIN users u ON lc.user_id = u.id
        WHERE lc.status = 'active'
        ORDER BY lc.lifetime_points DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Get card statistics (for admin)
 */
function getCardStats() {
    const db = getDatabase();

    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_cards,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_cards,
            SUM(points) as total_points,
            SUM(lifetime_points) as lifetime_points,
            AVG(points) as avg_points,
            COUNT(CASE WHEN tier = 'bronze' THEN 1 END) as bronze_count,
            COUNT(CASE WHEN tier = 'silver' THEN 1 END) as silver_count,
            COUNT(CASE WHEN tier = 'gold' THEN 1 END) as gold_count,
            COUNT(CASE WHEN tier = 'platinum' THEN 1 END) as platinum_count,
            COUNT(CASE WHEN tier = 'diamond' THEN 1 END) as diamond_count
        FROM loyalty_cards
    `).get();

    return stats;
}

module.exports = {
    applyForCard,
    autoApproveApplication,
    getLoyaltyCard,
    addPoints,
    deductPoints,
    calculateTier,
    getPointsHistory,
    getLeaderboard,
    getCardStats,
    TIER_THRESHOLDS
};
