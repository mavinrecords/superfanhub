/**
 * User Admin Service - Mavin SuperFan Hub
 *
 * Admin-side user lifecycle: create, reset password, suspend/unsuspend,
 * hard-delete. All sensitive ops are gated at the route layer; this module
 * just enforces invariants (e.g. cascade safety, irreversibility warnings).
 *
 * Foreign keys cascade from users(id) on every user-keyed table in
 * schema.sql, so DELETE FROM users WHERE id = ? cleans up:
 *   user_sessions, user_profiles, spotify_connections, lastfm_connections,
 *   loyalty_cards, loyalty_applications, streaming_history, user_campaigns,
 *   task_submissions, proof_submissions, contribution_scores,
 *   fan_tier_history, reward_redemptions, squad_members, streaks,
 *   leaderboard_cache, task_fraud_flags
 *
 * squads.leader_user_id is set to NULL (preserving the squad row).
 *
 * NOT cascaded (preserved as historical fact):
 *   loyalty_transactions (audit trail), gift_cards (anonymous after delete),
 *   referrals (other party may need to keep their record).
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDatabase, runTransaction } = require('../db/database');
const authService = require('./authService');

const SALT_ROUNDS = 12;

/**
 * Manually create a user from admin. Wraps authService.register and then
 * marks the row as verified (skips email verification flow). Returns the
 * inserted row.
 */
async function createUserAdmin({ email, password, name, phone = null }) {
    if (!email || !password || !name) {
        throw new Error('email, password, and name are required');
    }
    const result = await authService.register(email, password, name, phone);
    const db = getDatabase();
    db.prepare(`UPDATE users SET is_verified = 1 WHERE id = ?`).run(result.id);
    return getUserSummary(result.id);
}

/**
 * Generate a temporary password, hash it, store it, force change-on-login.
 * Returns the plaintext temp password ONCE in the response — the caller
 * (admin route) is responsible for handing it to the admin user securely.
 *
 * Also kills all active sessions for the target user so the new credential
 * actually takes effect.
 */
async function resetUserPassword(userId) {
    const db = getDatabase();
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');

    // Random 12-char URL-safe password (~71 bits entropy)
    const tempPassword = crypto.randomBytes(9).toString('base64')
        .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '');

    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    db.prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(passwordHash, userId);

    // Invalidate any active sessions
    const killed = db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);

    return {
        userId: user.id,
        email: user.email,
        name: user.name,
        tempPassword,                  // return ONCE — admin must record/relay
        sessionsRevoked: killed.changes,
        mustChangePassword: true
    };
}

/**
 * Suspend a user — sets is_suspended=1 and kills sessions. Login is
 * subsequently rejected by authService.login. Reversible via unsuspendUser.
 */
function suspendUser(userId, reason = null) {
    const db = getDatabase();
    const user = db.prepare('SELECT id, email, name, is_suspended FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    if (user.is_suspended === 1) {
        return { userId, alreadySuspended: true, sessionsRevoked: 0 };
    }
    db.prepare(`UPDATE users SET is_suspended = 1, updated_at = datetime('now') WHERE id = ?`).run(userId);
    const killed = db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    return {
        userId,
        email: user.email,
        name: user.name,
        suspended: true,
        reason: reason || null,
        sessionsRevoked: killed.changes
    };
}

function unsuspendUser(userId) {
    const db = getDatabase();
    const user = db.prepare('SELECT id, email, name, is_suspended FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    if (user.is_suspended === 0) {
        return { userId, alreadyActive: true };
    }
    db.prepare(`UPDATE users SET is_suspended = 0, updated_at = datetime('now') WHERE id = ?`).run(userId);
    return {
        userId,
        email: user.email,
        name: user.name,
        suspended: false
    };
}

/**
 * Hard-delete a user. Cascades automatically via FK ON DELETE CASCADE on
 * every user-keyed table. Returns a snapshot of the deleted row for audit.
 *
 * Caller is responsible for confirming the action with the admin user
 * (typed-confirm, double-prompt, etc.) — this function does not prompt.
 */
function deleteUser(userId) {
    const db = getDatabase();
    const snapshot = db.prepare(`
        SELECT id, email, name, phone, is_verified, is_suspended,
               created_at, updated_at
        FROM users WHERE id = ?
    `).get(userId);
    if (!snapshot) throw new Error('User not found');

    return runTransaction(() => {
        // Manual cleanup of tables that may not have ON DELETE CASCADE,
        // for completeness. squads.leader_user_id has ON DELETE SET NULL
        // (see schema.sql:463) so this is technically redundant — but
        // explicit is safer than relying on FK behavior across SQLite
        // versions.
        db.prepare(`UPDATE squads SET leader_user_id = NULL WHERE leader_user_id = ?`).run(userId);

        // referrals.referrer_user_id is added by migrate.js — older DBs
        // may not have it. Detect and skip gracefully so the delete still
        // succeeds in either deployment state.
        try {
            const hasRefUserId = db.pragma('table_info(referrals)').some(c => c.name === 'referrer_user_id');
            if (hasRefUserId) {
                db.prepare(`UPDATE referrals SET referrer_user_id = NULL WHERE referrer_user_id = ?`).run(userId);
            }
        } catch (_) { /* table missing or unreadable — ignore */ }

        const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

        return {
            userId,
            deleted: result.changes === 1,
            snapshot
        };
    });
}

/**
 * Lightweight user info row used after admin operations.
 */
function getUserSummary(userId) {
    const db = getDatabase();
    return db.prepare(`
        SELECT id, email, name, phone, is_verified, is_suspended,
               must_change_password, created_at, updated_at
        FROM users WHERE id = ?
    `).get(userId);
}

/**
 * List users for the admin management view (search, paginated).
 */
function listManagedUsers({ search = '', limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    const params = [];
    let where = '1=1';
    if (search) {
        where += ' AND (email LIKE ? OR name LIKE ?)';
        const like = `%${search}%`;
        params.push(like, like);
    }
    const rows = db.prepare(`
        SELECT id, email, name, phone, is_verified, is_suspended,
               must_change_password, created_at
        FROM users
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows;
}

module.exports = {
    createUserAdmin,
    resetUserPassword,
    suspendUser,
    unsuspendUser,
    deleteUser,
    getUserSummary,
    listManagedUsers
};
