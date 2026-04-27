/**
 * Admin audit service (T0-6)
 *
 * Records every state-mutating admin action. Called explicitly from route
 * handlers rather than via middleware, so we have full control over which
 * action name and entity/details we log per handler.
 *
 * Usage in a route:
 *   const { logAdminAction } = require('../services/adminAuditService');
 *   router.post('/admin/cards', requireAdmin, (req, res) => {
 *     const card = cardService.issueCard(...);
 *     logAdminAction(req, 'ISSUE_CARD', 'gift_card', card.id, {
 *       initial_balance: card.initial_balance,
 *       card_type: card.card_type
 *     });
 *     res.json(card);
 *   });
 */

const { getDatabase } = require('../db/database');

/**
 * Record an admin action.
 *
 * @param {Object} req    Express request (must have req.admin / req.session populated by requireAdmin)
 * @param {String} action short verb-object code like "ISSUE_CARD", "FREEZE_CARD", "ADJUST_POINTS"
 * @param {String} entityType e.g. "gift_card", "user", "campaign", "reward", "config"
 * @param {String|Number|null} entityId optional id of the affected entity
 * @param {Object|null} details arbitrary JSON-serializable detail object
 */
function logAdminAction(req, action, entityType = null, entityId = null, details = null) {
    try {
        const db = getDatabase();
        const adminId = (req && req.admin && req.admin.id) || (req && req.session && req.session.adminId) || null;
        const adminUsername = (req && req.admin && req.admin.username)
            || (req && req.session && req.session.adminUsername)
            || null;
        const ip = getClientIp(req);
        const userAgent = (req && req.headers && req.headers['user-agent']) || null;
        const detailsJson = details == null ? null : safeStringify(details);
        db.prepare(`
            INSERT INTO admin_audit_log
              (admin_id, admin_username, action, entity_type, entity_id, details_json, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            adminId,
            adminUsername,
            action,
            entityType,
            entityId == null ? null : String(entityId),
            detailsJson,
            ip,
            userAgent
        );
    } catch (err) {
        // Never let audit logging break a real operation.
        console.error('[adminAuditService] Failed to write audit row:', err.message);
    }
}

/**
 * Fetch recent admin actions with optional filters.
 * Supports basic offset pagination; T2-9 will extend with CSV export + date range.
 */
function getRecentActions({
    limit = 100,
    offset = 0,
    action = null,
    entityType = null,
    adminId = null,
    since = null,   // ISO string
    until = null    // ISO string
} = {}) {
    const db = getDatabase();
    const where = [];
    const params = [];
    if (action) { where.push('action = ?'); params.push(action); }
    if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
    if (adminId) { where.push('admin_id = ?'); params.push(adminId); }
    if (since) { where.push('created_at >= ?'); params.push(since); }
    if (until) { where.push('created_at < ?'); params.push(until); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const rows = db.prepare(`
        SELECT id, admin_id, admin_username, action, entity_type, entity_id,
               details_json, ip_address, user_agent, created_at
        FROM admin_audit_log
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    const totalRow = db.prepare(`
        SELECT COUNT(*) AS total FROM admin_audit_log ${whereClause}
    `).get(...params);
    return {
        rows: rows.map(r => ({
            ...r,
            details: r.details_json ? safeParse(r.details_json) : null
        })),
        total: totalRow ? totalRow.total : rows.length,
        limit: safeLimit,
        offset: safeOffset
    };
}

/** Distinct action codes seen so far — feeds the filter dropdown in the UI. */
function getDistinctActions() {
    const db = getDatabase();
    return db.prepare(
        'SELECT DISTINCT action FROM admin_audit_log ORDER BY action ASC'
    ).all().map(r => r.action);
}

function getClientIp(req) {
    if (!req) return null;
    return (
        (req.headers && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
        req.ip ||
        (req.connection && req.connection.remoteAddress) ||
        null
    );
}

function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch { return null; }
}

function safeParse(s) {
    try { return JSON.parse(s); } catch { return null; }
}

module.exports = {
    logAdminAction,
    getRecentActions,
    getDistinctActions
};
