/**
 * Campaign Service
 * Manages campaigns, challenges, and user participation
 */

const { getDatabase, runTransaction } = require('../db/database');
const { addPoints } = require('./loyaltyCardService');

/**
 * Create a new campaign
 */
function createCampaign({
    title,
    description,
    type,
    points,
    startDate,
    endDate,
    targetLink,
    targetId,
    imageUrl,
    createdBy
}) {
    const db = getDatabase();

    const stmt = db.prepare(`
        INSERT INTO campaigns (
            title, description, type, points, start_date, end_date,
            target_link, target_id, status, image_url, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(
        title,
        description,
        type,
        points,
        startDate,
        endDate,
        targetLink,
        targetId,
        imageUrl,
        createdBy
    );

    return getCampaignById(result.lastInsertRowid);
}

/**
 * Update an existing campaign
 */
function updateCampaign(id, updates) {
    const db = getDatabase();

    // Build dynamic query
    const fields = [];
    const values = [];

    // Allowed fields
    const allowed = ['title', 'description', 'type', 'points', 'start_date', 'end_date', 'target_link', 'target_id', 'status', 'image_url'];

    for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return getCampaignById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    const stmt = db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return getCampaignById(id);
}

/**
 * Get campaign by ID
 */
function getCampaignById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
}

/**
 * List campaigns with optional filtering
 */
function listCampaigns({ status, type, limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    let query = 'SELECT * FROM campaigns WHERE 1=1';
    const params = [];

    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }

    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params);
}

/**
 * Start a campaign (participate)
 */
function joinCampaign(userId, campaignId) {
    const db = getDatabase();

    // Check if campaign exists and is active
    const campaign = getCampaignById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status !== 'active') throw new Error('Campaign is not active');

    // Check if already joined
    const existing = db.prepare('SELECT * FROM user_campaigns WHERE user_id = ? AND campaign_id = ?').get(userId, campaignId);
    if (existing) {
        return existing; // Already joined, return current state
    }

    const stmt = db.prepare(`
        INSERT INTO user_campaigns (user_id, campaign_id, status, created_at)
        VALUES (?, ?, 'started', datetime('now'))
    `);

    stmt.run(userId, campaignId);

    return { status: 'started', campaignId, userId };
}

/**
 * Complete a campaign and award points
 */
function completeCampaign(userId, campaignId, proof = null) {
    const db = getDatabase();

    // Get campaign details
    const campaign = getCampaignById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    // Check user participation
    const participation = db.prepare('SELECT * FROM user_campaigns WHERE user_id = ? AND campaign_id = ?').get(userId, campaignId);

    if (!participation) {
        // Auto-join if not joined yet (convenience)
        joinCampaign(userId, campaignId);
    } else if (participation.status === 'completed') {
        throw new Error('Campaign already completed');
    }

    // Transaction: Update status and award points
    return runTransaction(() => {
        // Update user_campaigns
        db.prepare(`
            UPDATE user_campaigns 
            SET status = 'completed', completed_at = datetime('now'), points_awarded = ?, proof = ?
            WHERE user_id = ? AND campaign_id = ?
        `).run(campaign.points, proof, userId, campaignId);

        // Award points in loyalty system
        const pointResult = addPoints(userId, campaign.points, `Completed campaign: ${campaign.title}`, 'campaign');

        return {
            success: true,
            campaign: campaign.title,
            points: campaign.points,
            newBalance: pointResult.newBalance,
            newTier: pointResult.tier
        };
    });
}

/**
 * Get user's active/completed campaigns
 */
function getUserCampaigns(userId) {
    const db = getDatabase();

    // Get all campaigns with user status attached
    return db.prepare(`
        SELECT c.*, uc.status as user_status, uc.completed_at, uc.points_awarded
        FROM campaigns c
        LEFT JOIN user_campaigns uc ON c.id = uc.campaign_id AND uc.user_id = ?
        WHERE c.status = 'active'
        ORDER BY 
            CASE WHEN uc.status = 'started' THEN 0 
            WHEN uc.status IS NULL THEN 1 
            ELSE 2 END,
            c.end_date ASC
    `).all(userId);
}

/**
 * Delete a campaign. user_campaigns rows cascade via FK.
 * Returns the snapshot for audit trail.
 */
function deleteCampaign(id) {
    const db = getDatabase();
    const snapshot = getCampaignById(id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    return snapshot;
}

module.exports = {
    createCampaign,
    updateCampaign,
    deleteCampaign,
    getCampaignById,
    listCampaigns,
    joinCampaign,
    completeCampaign,
    getUserCampaigns
};
