// User Authentication Routes - Mavin SuperFan Hub
// Handles registration, login, logout, and profile management

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { requireUser } = require('../middleware/requireUser');

// =============================================================
// REGISTRATION
// =============================================================

router.post('/register', async (req, res) => {
    try {
        const { email, password, name, phone } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, password, and name are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        const result = await authService.register(email, password, name, phone);

        // TODO: Send verification email

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            user: {
                id: result.id,
                email: result.email,
                name: result.name
            }
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.message === 'Email already registered') {
            return res.status(409).json({ error: error.message });
        }

        res.status(500).json({ error: 'Registration failed' });
    }
});

// =============================================================
// LOGIN
// =============================================================

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const result = await authService.login(email, password, ipAddress, userAgent);

        // Store token in session (for cookie-based auth)
        req.session.userToken = result.token;
        req.session.userId = result.user.id;

        res.json({
            success: true,
            user: result.user,
            token: result.token,
            expiresAt: result.expiresAt
        });

    } catch (error) {
        console.error('Login error:', error);

        if (error.message === 'Invalid email or password') {
            return res.status(401).json({ error: error.message });
        }

        res.status(500).json({ error: 'Login failed' });
    }
});

// =============================================================
// LOGOUT
// =============================================================

router.post('/logout', requireUser, (req, res) => {
    try {
        authService.logout(req.userToken);

        // Clear session
        req.session.destroy();

        res.json({ success: true, message: 'Logged out successfully' });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// =============================================================
// SESSION CHECK
// =============================================================

router.get('/session', (req, res) => {
    let token = req.headers.authorization?.replace('Bearer ', '');

    if (!token && req.session?.userToken) {
        token = req.session.userToken;
    }

    if (!token) {
        return res.json({ authenticated: false });
    }

    const user = authService.validateSession(token);

    if (!user) {
        return res.json({ authenticated: false });
    }

    res.json({
        authenticated: true,
        user
    });
});

// =============================================================
// PROFILE
// =============================================================

router.get('/profile', requireUser, (req, res) => {
    try {
        const user = authService.getUserById(req.user.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

router.put('/profile', requireUser, (req, res) => {
    try {
        const updated = authService.updateProfile(req.user.id, req.body);
        res.json(updated);

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// =============================================================
// PASSWORD MANAGEMENT
// =============================================================

router.post('/password/reset-request', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const result = authService.requestPasswordReset(email);

        // TODO: Send password reset email with result.resetToken

        res.json({
            success: true,
            message: 'If an account exists with that email, a reset link has been sent'
        });

    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

router.post('/password/reset', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        await authService.resetPassword(token, newPassword);

        res.json({
            success: true,
            message: 'Password reset successfully. Please login with your new password.'
        });

    } catch (error) {
        console.error('Password reset error:', error);

        if (error.message.includes('Invalid or expired')) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Failed to reset password' });
    }
});

router.post('/password/change', requireUser, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        await authService.changePassword(req.user.id, currentPassword, newPassword);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Password change error:', error);

        if (error.message === 'Current password is incorrect') {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Failed to change password' });
    }
});

// =============================================================
// USER STATS (dashboard summary)
// =============================================================

router.get('/stats', requireUser, (req, res) => {
    try {
        const { getDatabase } = require('../db/database');
        const db = getDatabase();
        const userId = req.user.id;

        // Referral count
        const referrals = db.prepare(
            "SELECT COUNT(*) as count FROM referrals WHERE referrer_user_id = ? AND status = 'credited'"
        ).get(userId) || { count: 0 };

        // Gift card count linked to user
        const giftCards = db.prepare(
            "SELECT COUNT(*) as count FROM gift_cards WHERE user_id = ?"
        ).get(userId) || { count: 0 };

        // Monthly points (loyalty transactions this calendar month)
        const monthPoints = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM loyalty_transactions
            WHERE user_id = ?
              AND amount > 0
              AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get(userId) || { total: 0 };

        res.json({
            referralCount: referrals.count || 0,
            giftCardCount: giftCards.count || 0,
            monthlyPoints: monthPoints.total || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            referralCount: 0,
            giftCardCount: 0,
            monthlyPoints: 0
        });
    }
});

module.exports = router;
