// User Authentication Routes - Mavin SuperFan Hub
// Handles registration, login, logout, and profile management

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { requireUser, optionalUser } = require('../middleware/requireUser');

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

        // EMAIL VERIFICATION: token is at result.verificationToken
        // Wire emailService.sendVerificationEmail() when SMTP is configured (SMTP_HOST in .env)
        // try {
        //     await emailService.sendVerificationEmail(result.email, result.verificationToken);
        // } catch (emailErr) {
        //     console.error('Verification email failed (non-fatal):', emailErr.message);
        // }
        if (result.verificationToken) {
            console.log(`[Register] Verification token for ${email}: ${result.verificationToken} (configure SMTP to email this)`);
        }

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

// Sign-out must always succeed even if the bearer token is expired/invalid —
// otherwise the frontend's .finally() is the only thing clearing client state
// and any 401 here just adds noise to the console. `optionalUser` attaches
// req.userToken if present, but never 401s. We invalidate the DB-side session
// row when we have the token, destroy the express session either way, and
// clear the cookie client-side to defeat any CDN/proxy caching of the Set-Cookie.
router.post('/logout', optionalUser, (req, res) => {
    try {
        if (req.userToken) {
            try { authService.logout(req.userToken); } catch (_) { /* best-effort */ }
        }

        if (req.session) {
            req.session.destroy(() => {
                res.clearCookie('connect.sid', { path: '/' });
                res.json({ success: true, message: 'Logged out successfully' });
            });
            return;
        }

        res.clearCookie('connect.sid', { path: '/' });
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

        // PASSWORD RESET EMAIL: token is at result.resetToken
        // Wire emailService.sendPasswordResetEmail() when SMTP is configured (SMTP_HOST in .env)
        // try {
        //     await emailService.sendPasswordResetEmail(email, result.resetToken);
        // } catch (emailErr) {
        //     console.error('Reset email failed (non-fatal):', emailErr.message);
        // }
        if (result && result.resetToken) {
            console.log(`[PasswordReset] Reset token for ${email}: ${result.resetToken} (configure SMTP to email this)`);
        }

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

        // Referral count — join through users.email since referrals stores referrer_email
        const referrals = db.prepare(`
            SELECT COUNT(*) as count FROM referrals
            WHERE referrer_email = (SELECT email FROM users WHERE id = ?)
              AND status = 'completed'
        `).get(userId) || { count: 0 };

        // Gift card count linked to user
        const giftCards = db.prepare(
            "SELECT COUNT(*) as count FROM gift_cards WHERE user_id = ?"
        ).get(userId) || { count: 0 };

        // Monthly points — loyalty_transactions stores email, not user_id; join through users
        const monthPoints = db.prepare(`
            SELECT COALESCE(SUM(lt.amount), 0) as total
            FROM loyalty_transactions lt
            JOIN users u ON lt.email = u.email
            WHERE u.id = ?
              AND lt.amount > 0
              AND strftime('%Y-%m', lt.created_at) = strftime('%Y-%m', 'now')
        `).get(userId) || { total: 0 };

        res.json({
            referralCount: referrals.count || 0,
            giftCardCount: giftCards.count || 0,
            monthlyPoints: monthPoints.total || 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load user stats' });
    }
});

module.exports = router;
