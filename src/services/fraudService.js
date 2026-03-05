/**
 * Fraud Detection Service
 * Monitors for suspicious patterns and generates alerts
 */

const { getDatabase } = require('../db/database');

// Alert thresholds (configurable)
const THRESHOLDS = {
    FAILED_VALIDATIONS_PER_IP: 10,       // Max failed attempts per IP in 1 hour
    FAILED_VALIDATIONS_PER_CODE: 5,      // Max failed attempts per code prefix in 1 hour
    RAPID_REDEMPTIONS_COUNT: 3,          // Max redemptions for same card in 10 minutes
    HIGH_VALUE_REDEMPTION: 500,          // High value redemption threshold
    UNUSUAL_HOUR_START: 2,               // Unusual hours (2 AM - 5 AM)
    UNUSUAL_HOUR_END: 5
};

/**
 * Get current fraud alerts
 */
function getAlerts() {
    const alerts = [];

    // Check for IPs with multiple failed validations
    const suspiciousIPs = checkSuspiciousIPs();
    alerts.push(...suspiciousIPs);

    // Check for rapid redemptions
    const rapidRedemptions = checkRapidRedemptions();
    alerts.push(...rapidRedemptions);

    // Check for high-value redemptions
    const highValueAlerts = checkHighValueRedemptions();
    alerts.push(...highValueAlerts);

    // Check for unusual hour activity
    const unusualHourAlerts = checkUnusualHourActivity();
    alerts.push(...unusualHourAlerts);

    // Sort by severity and time
    alerts.sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return alerts;
}

/**
 * Check for IPs with multiple failed validations
 */
function checkSuspiciousIPs() {
    const db = getDatabase();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const suspicious = db.prepare(`
        SELECT ip_address, COUNT(*) as attempts
        FROM validation_attempts
        WHERE success = 0 AND attempted_at >= ?
        GROUP BY ip_address
        HAVING attempts >= ?
    `).all(oneHourAgo, THRESHOLDS.FAILED_VALIDATIONS_PER_IP);

    return suspicious.map(s => ({
        type: 'suspicious_ip',
        severity: s.attempts >= THRESHOLDS.FAILED_VALIDATIONS_PER_IP * 2 ? 'critical' : 'warning',
        title: 'Suspicious IP Activity',
        description: `IP ${s.ip_address} has ${s.attempts} failed validation attempts in the last hour`,
        ip: s.ip_address,
        count: s.attempts,
        timestamp: new Date().toISOString()
    }));
}

/**
 * Check for rapid redemptions on same card
 */
function checkRapidRedemptions() {
    const db = getDatabase();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const rapid = db.prepare(`
        SELECT t.card_id, g.code_prefix, COUNT(*) as count, SUM(t.amount) as total
        FROM transactions t
        JOIN gift_cards g ON t.card_id = g.id
        WHERE t.type = 'redeem' AND t.performed_at >= ?
        GROUP BY t.card_id
        HAVING count >= ?
    `).all(tenMinutesAgo, THRESHOLDS.RAPID_REDEMPTIONS_COUNT);

    return rapid.map(r => ({
        type: 'rapid_redemption',
        severity: 'warning',
        title: 'Rapid Redemptions Detected',
        description: `Card ${r.code_prefix}•••• has ${r.count} redemptions ($${r.total.toFixed(2)}) in 10 minutes`,
        cardId: r.card_id,
        codePrefix: r.code_prefix,
        count: r.count,
        total: r.total,
        timestamp: new Date().toISOString()
    }));
}

/**
 * Check for high-value single redemptions
 */
function checkHighValueRedemptions() {
    const db = getDatabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const highValue = db.prepare(`
        SELECT t.*, g.code_prefix
        FROM transactions t
        JOIN gift_cards g ON t.card_id = g.id
        WHERE t.type = 'redeem' 
        AND t.amount >= ?
        AND t.performed_at >= ?
        ORDER BY t.performed_at DESC
        LIMIT 10
    `).all(THRESHOLDS.HIGH_VALUE_REDEMPTION, oneDayAgo);

    return highValue.map(h => ({
        type: 'high_value',
        severity: 'info',
        title: 'High Value Redemption',
        description: `$${h.amount.toFixed(2)} redeemed from ${h.code_prefix}•••• by ${h.performed_by}`,
        amount: h.amount,
        cardId: h.card_id,
        performedBy: h.performed_by,
        timestamp: h.performed_at
    }));
}

/**
 * Check for activity during unusual hours
 */
function checkUnusualHourActivity() {
    const db = getDatabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const unusual = db.prepare(`
        SELECT t.*, g.code_prefix,
               CAST(strftime('%H', t.performed_at) AS INTEGER) as hour
        FROM transactions t
        JOIN gift_cards g ON t.card_id = g.id
        WHERE t.type = 'redeem' 
        AND t.performed_at >= ?
        AND CAST(strftime('%H', t.performed_at) AS INTEGER) BETWEEN ? AND ?
        LIMIT 10
    `).all(oneDayAgo, THRESHOLDS.UNUSUAL_HOUR_START, THRESHOLDS.UNUSUAL_HOUR_END);

    return unusual.map(u => ({
        type: 'unusual_hour',
        severity: 'info',
        title: 'Unusual Hour Activity',
        description: `Redemption at ${u.hour}:00 hours from ${u.code_prefix}••••`,
        hour: u.hour,
        cardId: u.card_id,
        amount: u.amount,
        timestamp: u.performed_at
    }));
}

/**
 * Get fraud summary stats
 */
function getFraudSummary() {
    const db = getDatabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const failedValidations24h = db.prepare(`
        SELECT COUNT(*) as count FROM validation_attempts
        WHERE success = 0 AND attempted_at >= ?
    `).get(oneDayAgo).count;

    const failedValidations1h = db.prepare(`
        SELECT COUNT(*) as count FROM validation_attempts
        WHERE success = 0 AND attempted_at >= ?
    `).get(oneHourAgo).count;

    const uniqueSuspiciousIPs = db.prepare(`
        SELECT COUNT(DISTINCT ip_address) as count FROM validation_attempts
        WHERE success = 0 AND attempted_at >= ?
        GROUP BY ip_address
        HAVING COUNT(*) >= ?
    `).all(oneHourAgo, THRESHOLDS.FAILED_VALIDATIONS_PER_IP).length;

    return {
        failedValidations24h,
        failedValidations1h,
        suspiciousIPs: uniqueSuspiciousIPs,
        alertCount: getAlerts().length
    };
}

module.exports = {
    getAlerts,
    getFraudSummary,
    THRESHOLDS
};
