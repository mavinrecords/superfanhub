/**
 * Leaderboard Service - Mavin Community Task Master
 * Build/refresh global + artist-specific leaderboards
 */

const { getDatabase } = require('../db/database');

/**
 * Refresh the leaderboard cache (called by scheduler)
 */
function refreshLeaderboard(scope = 'global', scopeId = null, period = 'all_time') {
    const db = getDatabase();

    // Clear existing cache for this scope/period
    if (scopeId) {
        db.prepare('DELETE FROM leaderboard_cache WHERE scope = ? AND scope_id = ? AND period = ?')
            .run(scope, scopeId, period);
    } else {
        db.prepare('DELETE FROM leaderboard_cache WHERE scope = ? AND scope_id IS NULL AND period = ?')
            .run(scope, period);
    }

    // Build leaderboard from contribution scores
    let query = `
        SELECT cs.user_id, u.name as user_name, cs.total_score, cs.tasks_completed,
               cs.current_tier, COALESCE(s.current_streak, 0) as streak
        FROM contribution_scores cs
        JOIN users u ON cs.user_id = u.id
        LEFT JOIN streaks s ON cs.user_id = s.user_id
    `;
    const params = [];

    if (scope === 'artist' && scopeId) {
        // Artist-specific: count only tasks for this artist
        query = `
            SELECT ts.user_id, u.name as user_name,
                   SUM(ts.points_awarded) as total_score,
                   COUNT(*) as tasks_completed,
                   COALESCE(cs.current_tier, 'fan') as current_tier,
                   COALESCE(s.current_streak, 0) as streak
            FROM task_submissions ts
            JOIN users u ON ts.user_id = u.id
            JOIN tasks t ON ts.task_id = t.id
            LEFT JOIN contribution_scores cs ON ts.user_id = cs.user_id
            LEFT JOIN streaks s ON ts.user_id = s.user_id
            WHERE ts.status = 'verified' AND t.artist_id = ?
            GROUP BY ts.user_id
        `;
        params.push(scopeId);
    }

    query += ' ORDER BY total_score DESC LIMIT 100';

    const rows = db.prepare(query).all(...params);

    // Insert with rank
    const insertStmt = db.prepare(`
        INSERT INTO leaderboard_cache 
        (user_id, user_name, scope, scope_id, rank, score, tasks_completed, current_tier, streak, period)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction(() => {
        rows.forEach((row, idx) => {
            insertStmt.run(
                row.user_id, row.user_name, scope, scopeId,
                idx + 1, row.total_score, row.tasks_completed,
                row.current_tier, row.streak, period
            );
        });
    });

    insertAll();
    return { entries: rows.length, scope, scopeId, period };
}

/**
 * Get leaderboard (from cache)
 */
function getLeaderboard({ scope = 'global', scopeId = null, period = 'all_time', limit = 25 } = {}) {
    const db = getDatabase();

    let query = `
        SELECT * FROM leaderboard_cache
        WHERE scope = ? AND period = ?
    `;
    const params = [scope, period];

    if (scopeId) {
        query += ' AND scope_id = ?';
        params.push(scopeId);
    } else {
        query += ' AND scope_id IS NULL';
    }

    query += ' ORDER BY rank ASC LIMIT ?';
    params.push(limit);

    const entries = db.prepare(query).all(...params);

    // If cache is empty, build it on-the-fly
    if (entries.length === 0) {
        refreshLeaderboard(scope, scopeId, period);
        return db.prepare(query).all(...params);
    }

    return entries;
}

/**
 * Get user's rank
 */
function getUserRank(userId, scope = 'global', scopeId = null) {
    const db = getDatabase();

    let query = 'SELECT * FROM leaderboard_cache WHERE user_id = ? AND scope = ?';
    const params = [userId, scope];

    if (scopeId) {
        query += ' AND scope_id = ?';
        params.push(scopeId);
    }

    query += " AND period = 'all_time'";

    return db.prepare(query).get(...params);
}

/**
 * Refresh all leaderboards (scheduler job)
 */
function refreshAllLeaderboards() {
    const db = getDatabase();

    // Refresh global
    refreshLeaderboard('global', null, 'all_time');

    // Refresh per artist
    const artists = db.prepare('SELECT DISTINCT artist_id FROM tasks WHERE artist_id IS NOT NULL').all();
    for (const { artist_id } of artists) {
        refreshLeaderboard('artist', artist_id, 'all_time');
    }

    return { refreshed: 1 + artists.length };
}

module.exports = {
    refreshLeaderboard,
    getLeaderboard,
    getUserRank,
    refreshAllLeaderboards
};
