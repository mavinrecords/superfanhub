// User Authentication Middleware - Mavin SuperFan Hub
// Protects routes that require a logged-in user

const authService = require('../services/authService');

/**
 * Middleware to require user authentication
 * Looks for session token in Authorization header or cookie
 */
function requireUser(req, res, next) {
    // Try to get token from Authorization header
    let token = req.headers.authorization?.replace('Bearer ', '');

    // Fallback to session cookie
    if (!token && req.session?.userToken) {
        token = req.session.userToken;
    }

    // Fallback to query param (for OAuth callbacks)
    if (!token && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const user = authService.validateSession(token);

    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Attach user to request
    req.user = user;
    req.userToken = token;

    next();
}

/**
 * Optional user middleware - doesn't fail if not authenticated
 * Useful for pages that work for both logged in and anonymous users
 */
function optionalUser(req, res, next) {
    let token = req.headers.authorization?.replace('Bearer ', '');

    if (!token && req.session?.userToken) {
        token = req.session.userToken;
    }

    if (token) {
        const user = authService.validateSession(token);
        if (user) {
            req.user = user;
            req.userToken = token;
        }
    }

    next();
}

/**
 * Middleware to require verified email
 */
function requireVerified(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.isVerified) {
        return res.status(403).json({ error: 'Email verification required' });
    }

    next();
}

module.exports = {
    requireUser,
    optionalUser,
    requireVerified
};
