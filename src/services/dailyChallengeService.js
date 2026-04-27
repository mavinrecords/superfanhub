/**
 * Daily Challenge Service - Mavin SuperFan Hub
 *
 * Admin-side CRUD for the daily_challenges table. Coexists with the
 * scheduler's auto-generation in src/services/scheduler.js — the table has
 * NO unique constraint on (task_id, challenge_date), so admin- and
 * scheduler-created rows live side by side without conflict.
 *
 * The user-facing /api/tasks/challenges/today endpoint joins this table to
 * tasks, so any row added here surfaces immediately on the user dashboard
 * for the matching challenge_date.
 */

const { getDatabase } = require('../db/database');

const ALLOWED_TYPES = ['daily', 'weekly'];

/**
 * List challenges, optionally filtered by date range or type.
 * Joins tasks for display info (title + points).
 */
function listChallenges({ since, until, challengeType, limit = 100, offset = 0 } = {}) {
    const db = getDatabase();
    let query = `
        SELECT dc.id, dc.task_id, dc.challenge_date, dc.challenge_type, dc.bonus_points,
               dc.is_active, dc.created_at,
               t.title as task_title, t.type as task_type, t.points as task_points,
               t.artist_name, t.status as task_status
        FROM daily_challenges dc
        LEFT JOIN tasks t ON t.id = dc.task_id
        WHERE 1=1
    `;
    const params = [];
    if (since) { query += ' AND dc.challenge_date >= ?'; params.push(since); }
    if (until) { query += ' AND dc.challenge_date <= ?'; params.push(until); }
    if (challengeType) { query += ' AND dc.challenge_type = ?'; params.push(challengeType); }
    query += ' ORDER BY dc.challenge_date DESC, dc.challenge_type, dc.bonus_points DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.prepare(query).all(...params);
}

function getChallengeById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM daily_challenges WHERE id = ?').get(id) || null;
}

/**
 * Create a challenge. Validates the referenced task exists.
 */
function createChallenge({ taskId, challengeDate, challengeType = 'daily', bonusPoints = 0, isActive = 1 }) {
    if (!taskId) throw new Error('taskId is required');
    if (!challengeDate) throw new Error('challengeDate is required (YYYY-MM-DD)');
    if (!ALLOWED_TYPES.includes(challengeType)) {
        throw new Error(`challengeType must be one of: ${ALLOWED_TYPES.join(', ')}`);
    }

    const db = getDatabase();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('Task not found');

    const result = db.prepare(`
        INSERT INTO daily_challenges (task_id, challenge_date, challenge_type, bonus_points, is_active)
        VALUES (?, ?, ?, ?, ?)
    `).run(taskId, challengeDate, challengeType, Number(bonusPoints) || 0, isActive ? 1 : 0);

    return getChallengeById(result.lastInsertRowid);
}

/**
 * Patch a challenge. Allowlist: challenge_date, challenge_type, bonus_points, is_active, task_id.
 */
function updateChallenge(id, updates) {
    const db = getDatabase();
    const allowed = ['task_id', 'challenge_date', 'challenge_type', 'bonus_points', 'is_active'];

    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates || {})) {
        if (!allowed.includes(key)) continue;
        if (key === 'challenge_type' && !ALLOWED_TYPES.includes(value)) {
            throw new Error(`challenge_type must be one of: ${ALLOWED_TYPES.join(', ')}`);
        }
        fields.push(`${key} = ?`);
        values.push(value);
    }
    if (fields.length === 0) return getChallengeById(id);

    values.push(id);
    db.prepare(`UPDATE daily_challenges SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getChallengeById(id);
}

/**
 * Hard-delete a challenge. Returns the snapshot for audit.
 */
function deleteChallenge(id) {
    const db = getDatabase();
    const snapshot = getChallengeById(id);
    db.prepare('DELETE FROM daily_challenges WHERE id = ?').run(id);
    return snapshot;
}

module.exports = {
    listChallenges,
    getChallengeById,
    createChallenge,
    updateChallenge,
    deleteChallenge
};
