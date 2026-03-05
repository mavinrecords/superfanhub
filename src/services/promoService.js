/**
 * Promo Service
 * Manages promotional campaigns and special offers
 */

const { getDatabase } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a promotional campaign
 */
function createCampaign(name, discountPercent, maxUses, expiresAt) {
    const db = getDatabase();

    // Store campaign metadata (using metadata table or similar if existed, for now mock via cards)
    // Actually we can just generate a batch of cards or a special "campaign code" logic.
    // Let's implement creating a batch of cards linked to this campaign.

    // Since we don't have a campaigns table, we'll return a batch config
    return {
        id: uuidv4(),
        name,
        discountPercent,
        maxUses,
        expiresAt
    };
}

/**
 * Generate promo codes for campaign
 */
function generatePromoCodes(campaign, count = 100, prefix = 'PROMO') {
    const db = getDatabase();
    const codes = [];

    const insert = db.prepare(`
        INSERT INTO gift_cards (
            code, code_prefix, initial_value, current_balance, 
            card_type, discount_percent, discount_uses_remaining, 
            status, expires_at, created_at, issued_by
        ) VALUES (?, ?, 0, 0, 'discount', ?, ?, 'active', ?, datetime('now'), 'system_promo')
    `);

    const transaction = db.transaction(() => {
        for (let i = 0; i < count; i++) {
            const codeSuffix = uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase();
            const code = `${prefix}${codeSuffix}`;

            insert.run(
                code,
                prefix,
                campaign.discountPercent,
                campaign.maxUses,
                campaign.expiresAt
            );

            codes.push(code);
        }
    });

    transaction();

    return {
        campaignId: campaign.id,
        count: codes.length,
        prefix
    };
}

/**
 * Get campaign stats
 */
function getCampaignStats(prefix) {
    const db = getDatabase();

    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_codes,
            SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed_count,
            AVG(discount_percent) as avg_discount
        FROM gift_cards 
        WHERE code_prefix = ?
    `).get(prefix);

    return stats;
}

module.exports = {
    createCampaign,
    generatePromoCodes,
    getCampaignStats
};
