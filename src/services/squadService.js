/**
 * Squad Service - Mavin Community Task Master
 * Squad creation, membership, and team mission management
 */

const { getDatabase, runTransaction } = require('../db/database');

/**
 * Create a new squad
 */
function createSquad({ name, artistId, artistName, description, maxMembers, leaderUserId }) {
    const db = getDatabase();
    const result = db.prepare(`
        INSERT INTO squads (name, artist_id, artist_name, description, max_members, leader_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, artistId || null, artistName || null, description || '', maxMembers || 50, leaderUserId || null);

    // Add leader as member
    if (leaderUserId) {
        db.prepare(`
            INSERT OR IGNORE INTO squad_members (squad_id, user_id, role) VALUES (?, ?, 'leader')
        `).run(result.lastInsertRowid, leaderUserId);
    }

    return getSquadById(result.lastInsertRowid);
}

/**
 * Get squad by ID
 */
function getSquadById(id) {
    const db = getDatabase();
    const squad = db.prepare('SELECT * FROM squads WHERE id = ?').get(id);
    if (!squad) return null;

    const members = db.prepare(`
        SELECT sm.*, u.name, u.email FROM squad_members sm
        JOIN users u ON sm.user_id = u.id
        WHERE sm.squad_id = ?
        ORDER BY sm.contribution DESC
    `).all(id);

    const missions = db.prepare(`
        SELECT sqm.*, t.title, t.type, t.points FROM squad_missions sqm
        JOIN tasks t ON sqm.task_id = t.id
        WHERE sqm.squad_id = ? AND sqm.status = 'active'
    `).all(id);

    return { ...squad, members, missions, memberCount: members.length };
}

/**
 * Join a squad
 */
function joinSquad(userId, squadId) {
    const db = getDatabase();
    const squad = db.prepare('SELECT * FROM squads WHERE id = ? AND is_active = 1').get(squadId);
    if (!squad) throw new Error('Squad not found');

    const memberCount = db.prepare('SELECT COUNT(*) as count FROM squad_members WHERE squad_id = ?').get(squadId).count;
    if (memberCount >= squad.max_members) throw new Error('Squad is full');

    const existing = db.prepare('SELECT * FROM squad_members WHERE squad_id = ? AND user_id = ?').get(squadId, userId);
    if (existing) return { status: 'already_member' };

    db.prepare('INSERT INTO squad_members (squad_id, user_id) VALUES (?, ?)').run(squadId, userId);
    return { status: 'joined', squadId };
}

/**
 * Leave a squad
 */
function leaveSquad(userId, squadId) {
    const db = getDatabase();
    db.prepare('DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?').run(squadId, userId);
    return { status: 'left' };
}

/**
 * Get user's squads
 */
function getUserSquads(userId) {
    const db = getDatabase();
    return db.prepare(`
        SELECT s.*, sm.role, sm.contribution,
            (SELECT COUNT(*) FROM squad_members WHERE squad_id = s.id) as member_count
        FROM squads s
        JOIN squad_members sm ON s.id = sm.squad_id
        WHERE sm.user_id = ? AND s.is_active = 1
    `).all(userId);
}

/**
 * List available squads
 */
function listSquads({ artistId, limit = 20 } = {}) {
    const db = getDatabase();
    let query = `
        SELECT s.*, 
            (SELECT COUNT(*) FROM squad_members WHERE squad_id = s.id) as member_count
        FROM squads s WHERE s.is_active = 1
    `;
    const params = [];

    if (artistId) { query += ' AND s.artist_id = ?'; params.push(artistId); }

    query += ' ORDER BY s.total_score DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
}

/**
 * Record squad contribution from a task completion
 */
function recordSquadContribution(userId, taskId, points) {
    const db = getDatabase();

    // Get user's squads
    const memberships = db.prepare('SELECT squad_id FROM squad_members WHERE user_id = ?').all(userId);

    for (const { squad_id } of memberships) {
        // Update member contribution
        db.prepare(`
            UPDATE squad_members SET contribution = contribution + ? WHERE squad_id = ? AND user_id = ?
        `).run(points, squad_id, userId);

        // Update squad total
        db.prepare(`
            UPDATE squads SET total_score = total_score + ?, updated_at = datetime('now') WHERE id = ?
        `).run(points, squad_id);

        // Check squad missions
        const missions = db.prepare(`
            SELECT sqm.* FROM squad_missions sqm
            JOIN tasks t ON sqm.task_id = t.id
            WHERE sqm.squad_id = ? AND sqm.status = 'active' AND sqm.task_id = ?
        `).all(squad_id, taskId);

        for (const mission of missions) {
            db.prepare(`
                UPDATE squad_missions 
                SET current_completions = current_completions + 1, 
                    status = CASE WHEN current_completions + 1 >= target_completions THEN 'completed' ELSE 'active' END,
                    completed_at = CASE WHEN current_completions + 1 >= target_completions THEN datetime('now') ELSE NULL END
                WHERE id = ?
            `).run(mission.id);
        }
    }
}

/**
 * Create a squad mission
 */
function createSquadMission({ squadId, taskId, targetCompletions, bonusPoints }) {
    const db = getDatabase();
    const result = db.prepare(`
        INSERT INTO squad_missions (squad_id, task_id, target_completions, bonus_points)
        VALUES (?, ?, ?, ?)
    `).run(squadId, taskId, targetCompletions || 10, bonusPoints || 0);

    return db.prepare('SELECT * FROM squad_missions WHERE id = ?').get(result.lastInsertRowid);
}

// ─── ADMIN CRUD EXTENSIONS (Tier 2) ─────────────────────────────────

/**
 * Update a squad
 */
function updateSquad(id, updates) {
    const db = getDatabase();
    const allowed = ['name', 'artist_id', 'artist_name', 'description', 'max_members', 'leader_user_id', 'is_active'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }
    if (fields.length === 0) return getSquadById(id);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE squads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getSquadById(id);
}

/**
 * Delete a squad. squad_members and squad_missions cascade automatically
 * via FK ON DELETE CASCADE in schema. Returns snapshot for audit trail.
 */
function deleteSquad(id) {
    const db = getDatabase();
    const snapshot = getSquadById(id);
    db.prepare('DELETE FROM squad_missions WHERE squad_id = ?').run(id);
    db.prepare('DELETE FROM squads WHERE id = ?').run(id);
    return snapshot;
}

/**
 * Remove a single member from a squad
 */
function removeSquadMember(squadId, userId) {
    const db = getDatabase();
    const snapshot = db.prepare(
        'SELECT sm.*, u.email FROM squad_members sm JOIN users u ON sm.user_id = u.id WHERE sm.squad_id = ? AND sm.user_id = ?'
    ).get(squadId, userId);
    db.prepare('DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?').run(squadId, userId);
    return snapshot;
}

/**
 * Set a member's role within a squad
 */
function setSquadMemberRole(squadId, userId, role) {
    const db = getDatabase();
    if (!['leader', 'member'].includes(role)) {
        throw new Error('Invalid role; must be leader or member');
    }
    db.prepare('UPDATE squad_members SET role = ? WHERE squad_id = ? AND user_id = ?')
        .run(role, squadId, userId);
    return db.prepare('SELECT * FROM squad_members WHERE squad_id = ? AND user_id = ?').get(squadId, userId);
}

/**
 * List squads for admin with members count + leader info — no is_active filter.
 */
function listSquadsAdmin({ limit = 100, offset = 0 } = {}) {
    const db = getDatabase();
    return db.prepare(`
        SELECT s.*,
            (SELECT COUNT(*) FROM squad_members WHERE squad_id = s.id) as member_count,
            (SELECT u.name FROM users u WHERE u.id = s.leader_user_id) as leader_name
        FROM squads s
        ORDER BY s.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
}

module.exports = {
    createSquad, getSquadById, joinSquad, leaveSquad,
    getUserSquads, listSquads, recordSquadContribution,
    createSquadMission,
    updateSquad, deleteSquad,
    removeSquadMember, setSquadMemberRole,
    listSquadsAdmin
};
