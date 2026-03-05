/**
 * Analytics Service
 * Provides statistical data for admin dashboard
 */

const { getDatabase } = require('../db/database');

/**
 * Get comprehensive analytics data
 */
function getAnalytics(period = '30d') {
    const db = getDatabase();

    // Calculate date range
    let daysBack = 30;
    if (period === '7d') daysBack = 7;
    if (period === '90d') daysBack = 90;
    if (period === '365d') daysBack = 365;

    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    // Summary stats
    const totalCards = db.prepare(`SELECT COUNT(*) as count FROM gift_cards`).get().count;
    const activeCards = db.prepare(`SELECT COUNT(*) as count FROM gift_cards WHERE status = 'active'`).get().count;
    const totalBalance = db.prepare(`SELECT COALESCE(SUM(current_balance), 0) as total FROM gift_cards WHERE status = 'active'`).get().total;
    const totalRedeemed = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total 
        FROM transactions 
        WHERE type = 'redeem' AND performed_at >= ?
    `).get(startDate).total;

    // Cards by tier
    const byTier = db.prepare(`
        SELECT tier, COUNT(*) as count, SUM(current_balance) as balance
        FROM gift_cards 
        WHERE status = 'active'
        GROUP BY tier
    `).all();

    // Cards by type
    const byType = db.prepare(`
        SELECT card_type, COUNT(*) as count
        FROM gift_cards 
        WHERE status = 'active'
        GROUP BY card_type
    `).all();

    // Cards by status
    const byStatus = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM gift_cards 
        GROUP BY status
    `).all();

    // Redemption trend (daily for last N days)
    const redemptionTrend = db.prepare(`
        SELECT 
            DATE(performed_at) as date,
            COUNT(*) as count,
            SUM(amount) as total
        FROM transactions 
        WHERE type = 'redeem' AND performed_at >= ?
        GROUP BY DATE(performed_at)
        ORDER BY date ASC
    `).all(startDate);

    // Top redemptions (recent)
    const recentRedemptions = db.prepare(`
        SELECT 
            t.id, t.amount, t.performed_at, t.performed_by,
            g.code_prefix, g.tier
        FROM transactions t
        JOIN gift_cards g ON t.card_id = g.id
        WHERE t.type = 'redeem'
        ORDER BY t.performed_at DESC
        LIMIT 10
    `).all();

    // Issuance trend
    const issuanceTrend = db.prepare(`
        SELECT 
            DATE(issued_at) as date,
            COUNT(*) as count,
            SUM(initial_value) as total
        FROM gift_cards 
        WHERE issued_at >= ?
        GROUP BY DATE(issued_at)
        ORDER BY date ASC
    `).all(startDate);

    // Cards expiring soon
    const expiringCards = db.prepare(`
        SELECT 
            id, code_prefix, tier, current_balance, expires_at,
            CAST((julianday(expires_at) - julianday('now')) AS INTEGER) as days_left
        FROM gift_cards 
        WHERE status = 'active' 
        AND current_balance > 0
        AND expires_at IS NOT NULL
        AND julianday(expires_at) - julianday('now') BETWEEN 0 AND 30
        ORDER BY expires_at ASC
        LIMIT 10
    `).all();

    // Revenue metrics
    const totalIssued = db.prepare(`SELECT COALESCE(SUM(initial_value), 0) as total FROM gift_cards`).get().total;
    const totalRedeemedAllTime = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'redeem'`).get().total;
    const utilizationRate = totalIssued > 0 ? (totalRedeemedAllTime / totalIssued * 100).toFixed(1) : 0;

    return {
        summary: {
            totalCards,
            activeCards,
            totalBalance,
            totalRedeemed,
            totalIssued,
            utilizationRate,
            period
        },
        distribution: {
            byTier,
            byType,
            byStatus
        },
        trends: {
            redemptions: redemptionTrend,
            issuances: issuanceTrend
        },
        recent: {
            redemptions: recentRedemptions,
            expiring: expiringCards
        }
    };
}

module.exports = {
    getAnalytics
};
