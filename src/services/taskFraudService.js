/**
 * Task Fraud Service - Mavin Community Task Master
 * Anti-fraud: duplicate detection, velocity abuse, bot patterns
 */

const { getDatabase } = require('../db/database');

const TASK_FRAUD_THRESHOLDS = {
    MAX_COMPLETIONS_PER_HOUR: 20,
    MAX_COMPLETIONS_PER_DAY: 50,
    SAME_PROOF_LIMIT: 2,
    MIN_COMPLETION_TIME_MS: 5000 // 5 seconds minimum
};

/**
 * Check for fraud before completing a task
 * Returns: { flagged: boolean, flags: Array }
 */
function checkSubmissionFraud(userId, taskId, proofData) {
    const flags = [];

    // 1. Velocity check
    const velocityFlag = checkVelocity(userId);
    if (velocityFlag) flags.push(velocityFlag);

    // 2. Duplicate proof check
    const dupeFlag = checkDuplicateProof(userId, proofData);
    if (dupeFlag) flags.push(dupeFlag);

    // 3. Same proof reuse across tasks
    const reuseFlag = checkProofReuse(proofData);
    if (reuseFlag) flags.push(reuseFlag);

    // Save flags
    if (flags.length > 0) {
        saveFraudFlags(userId, null, flags);
    }

    return {
        flagged: flags.length > 0,
        flags,
        severity: flags.length > 0 ? getMaxSeverity(flags) : 'none'
    };
}

/**
 * Check velocity (too many completions in short time)
 */
function checkVelocity(userId) {
    const db = getDatabase();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const hourCount = db.prepare(`
        SELECT COUNT(*) as count FROM task_submissions 
        WHERE user_id = ? AND status = 'verified' AND completed_at >= ?
    `).get(userId, oneHourAgo).count;

    if (hourCount >= TASK_FRAUD_THRESHOLDS.MAX_COMPLETIONS_PER_HOUR) {
        return {
            type: 'velocity_abuse',
            severity: 'high',
            details: `${hourCount} completions in the last hour (limit: ${TASK_FRAUD_THRESHOLDS.MAX_COMPLETIONS_PER_HOUR})`
        };
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dayCount = db.prepare(`
        SELECT COUNT(*) as count FROM task_submissions 
        WHERE user_id = ? AND status = 'verified' AND completed_at >= ?
    `).get(userId, oneDayAgo).count;

    if (dayCount >= TASK_FRAUD_THRESHOLDS.MAX_COMPLETIONS_PER_DAY) {
        return {
            type: 'velocity_abuse',
            severity: 'medium',
            details: `${dayCount} completions in the last 24 hours (limit: ${TASK_FRAUD_THRESHOLDS.MAX_COMPLETIONS_PER_DAY})`
        };
    }

    return null;
}

/**
 * Check for duplicate proof data
 */
function checkDuplicateProof(userId, proofData) {
    if (!proofData) return null;

    const db = getDatabase();
    const dupes = db.prepare(`
        SELECT COUNT(*) as count FROM task_submissions  
        WHERE user_id = ? AND proof_data = ? AND status = 'verified'
    `).get(userId, proofData).count;

    if (dupes >= TASK_FRAUD_THRESHOLDS.SAME_PROOF_LIMIT) {
        return {
            type: 'duplicate_proof',
            severity: 'medium',
            details: `Same proof used ${dupes} times`
        };
    }

    return null;
}

/**
 * Check if proof has been reused across users
 */
function checkProofReuse(proofData) {
    if (!proofData) return null;

    const db = getDatabase();
    const reuse = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as users FROM task_submissions
        WHERE proof_data = ? AND status = 'verified'
    `).get(proofData).users;

    if (reuse >= 2) {
        return {
            type: 'same_proof_reuse',
            severity: 'high',
            details: `Same proof used by ${reuse} different users`
        };
    }

    return null;
}

/**
 * Save fraud flags to database
 */
function saveFraudFlags(userId, submissionId, flags) {
    const db = getDatabase();
    const stmt = db.prepare(`
        INSERT INTO task_fraud_flags (user_id, submission_id, flag_type, severity, details)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const flag of flags) {
        stmt.run(userId, submissionId, flag.type, flag.severity, flag.details);
    }
}

/**
 * Get unresolved fraud flags (admin)
 */
function getUnresolvedFlags({ limit = 50, severity } = {}) {
    const db = getDatabase();
    let query = `
        SELECT ff.*, u.name as user_name, u.email
        FROM task_fraud_flags ff
        JOIN users u ON ff.user_id = u.id
        WHERE ff.resolved = 0
    `;
    const params = [];

    if (severity) { query += ' AND ff.severity = ?'; params.push(severity); }

    query += ' ORDER BY ff.created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
}

/**
 * Resolve a fraud flag
 */
function resolveFlag(flagId, resolvedBy) {
    const db = getDatabase();
    db.prepare(`
        UPDATE task_fraud_flags SET resolved = 1, resolved_by = ?, resolved_at = datetime('now')
        WHERE id = ?
    `).run(resolvedBy, flagId);
}

/**
 * Get fraud summary (admin dashboard)
 */
function getTaskFraudSummary() {
    const db = getDatabase();
    return db.prepare(`
        SELECT 
            COUNT(*) as total_flags,
            SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) as unresolved,
            SUM(CASE WHEN severity = 'critical' AND resolved = 0 THEN 1 ELSE 0 END) as critical_unresolved,
            SUM(CASE WHEN severity = 'high' AND resolved = 0 THEN 1 ELSE 0 END) as high_unresolved,
            (SELECT COUNT(DISTINCT user_id) FROM task_fraud_flags WHERE resolved = 0) as flagged_users
        FROM task_fraud_flags
    `).get();
}

function getMaxSeverity(flags) {
    const order = { critical: 3, high: 2, medium: 1, low: 0 };
    return flags.reduce((max, f) => order[f.severity] > order[max] ? f.severity : max, 'low');
}

module.exports = {
    checkSubmissionFraud,
    getUnresolvedFlags,
    resolveFlag,
    getTaskFraudSummary,
    TASK_FRAUD_THRESHOLDS
};
