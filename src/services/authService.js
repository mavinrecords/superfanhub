// Authentication Service - Mavin SuperFan Hub
// Handles user registration, login, password hashing, and session management

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDatabase } = require('../db/database');

const SALT_ROUNDS = 12;
const SESSION_EXPIRY_DAYS = 30;

/**
 * Register a new user
 */
async function register(email, password, name, phone = null) {
    const db = getDatabase();

    // Check if email exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
        throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Generate verification token (for future email verification)
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Insert user
    const stmt = db.prepare(`
        INSERT INTO users (email, password_hash, name, phone, verification_token, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    const result = stmt.run(email.toLowerCase(), passwordHash, name, phone, verificationToken);

    // Create empty profile
    db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(result.lastInsertRowid);

    return {
        id: result.lastInsertRowid,
        email: email.toLowerCase(),
        name,
        verificationToken
    };
}

/**
 * Login user and create session
 */
async function login(email, password, ipAddress = null, userAgent = null) {
    const db = getDatabase();

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
        throw new Error('Invalid email or password');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
        throw new Error('Invalid email or password');
    }

    // Create session token
    const sessionToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

    db.prepare(`
        INSERT INTO user_sessions (user_id, token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id, sessionToken, ipAddress, userAgent, expiresAt.toISOString());

    // Update last login (we can add this column later)

    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            isVerified: user.is_verified === 1
        },
        token: sessionToken,
        expiresAt: expiresAt.toISOString()
    };
}

/**
 * Validate session token
 */
function validateSession(token) {
    if (!token) return null;

    const db = getDatabase();

    const session = db.prepare(`
        SELECT us.*, u.id as user_id, u.email, u.name, u.is_verified
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
        WHERE us.token = ? AND us.expires_at > datetime('now')
    `).get(token);

    if (!session) return null;

    return {
        id: session.user_id,
        email: session.email,
        name: session.name,
        isVerified: session.is_verified === 1
    };
}

/**
 * Logout - invalidate session
 */
function logout(token) {
    const db = getDatabase();
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    return true;
}

/**
 * Get user by ID
 */
function getUserById(userId) {
    const db = getDatabase();

    const user = db.prepare(`
        SELECT u.*, up.avatar_url, up.bio, up.favorite_artist, up.city, up.country
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.id = ?
    `).get(userId);

    if (!user) return null;

    return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        isVerified: user.is_verified === 1,
        profile: {
            avatarUrl: user.avatar_url,
            bio: user.bio,
            favoriteArtist: user.favorite_artist,
            city: user.city,
            country: user.country
        },
        createdAt: user.created_at
    };
}

/**
 * Update user profile
 */
function updateProfile(userId, profileData) {
    const db = getDatabase();

    const { avatarUrl, bio, favoriteArtist, city, country, phone, name } = profileData;

    // Update user table
    if (name || phone !== undefined) {
        db.prepare(`
            UPDATE users SET name = COALESCE(?, name), phone = ?, updated_at = datetime('now')
            WHERE id = ?
        `).run(name, phone, userId);
    }

    // Update profile
    db.prepare(`
        UPDATE user_profiles SET
            avatar_url = COALESCE(?, avatar_url),
            bio = COALESCE(?, bio),
            favorite_artist = COALESCE(?, favorite_artist),
            city = COALESCE(?, city),
            country = COALESCE(?, country),
            updated_at = datetime('now')
        WHERE user_id = ?
    `).run(avatarUrl, bio, favoriteArtist, city, country, userId);

    return getUserById(userId);
}

/**
 * Request password reset
 */
function requestPasswordReset(email) {
    const db = getDatabase();

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
        // Don't reveal if email exists
        return { success: true };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1); // 1 hour expiry

    db.prepare(`
        UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?
    `).run(resetToken, expires.toISOString(), user.id);

    return { success: true, resetToken, userId: user.id };
}

/**
 * Reset password with token
 */
async function resetPassword(resetToken, newPassword) {
    const db = getDatabase();

    const user = db.prepare(`
        SELECT id FROM users 
        WHERE reset_token = ? AND reset_token_expires > datetime('now')
    `).get(resetToken);

    if (!user) {
        throw new Error('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    db.prepare(`
        UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL
        WHERE id = ?
    `).run(passwordHash, user.id);

    // Invalidate all sessions
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);

    return { success: true };
}

/**
 * Change password (logged in user)
 */
async function changePassword(userId, currentPassword, newPassword) {
    const db = getDatabase();

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
        throw new Error('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);

    return { success: true };
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
    return result.changes;
}

module.exports = {
    register,
    login,
    validateSession,
    logout,
    getUserById,
    updateProfile,
    requestPasswordReset,
    resetPassword,
    changePassword,
    cleanupExpiredSessions
};
