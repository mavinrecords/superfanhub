const bcrypt = require('bcrypt');
const { getDatabase } = require('../db/database');

// Simple session-based admin authentication
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDatabase();
    const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);

    if (!admin) {
        req.session.destroy();
        return res.status(401).json({ error: 'Invalid session' });
    }

    req.admin = admin;
    next();
}

// Login handler
async function login(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDatabase();
    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

    if (!admin) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    db.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?')
        .run(new Date().toISOString(), admin.id);

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    req.session.adminRole = admin.role;

    res.json({
        success: true,
        admin: {
            id: admin.id,
            username: admin.username,
            role: admin.role
        }
    });
}

// Logout handler
function logout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.json({ success: true });
    });
}

// Check session status
function checkSession(req, res) {
    if (req.session && req.session.adminId) {
        res.json({
            authenticated: true,
            admin: {
                id: req.session.adminId,
                username: req.session.adminUsername,
                role: req.session.adminRole
            }
        });
    } else {
        res.json({ authenticated: false });
    }
}

// Change password
async function changePassword(req, res) {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const db = getDatabase();
    const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.id);

    const validPassword = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
        .run(newHash, admin.id);

    res.json({ success: true, message: 'Password changed successfully' });
}

module.exports = {
    requireAdmin,
    login,
    logout,
    checkSession,
    changePassword
};
