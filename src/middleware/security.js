const rateLimit = require('express-rate-limit');
const { getDatabase } = require('../db/database');

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict rate limiter for validation attempts
const validationLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 5, // 5 validation attempts per minute
    message: { error: 'Too many validation attempts. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
});

// Admin login rate limiter
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Check for suspicious validation patterns
function checkSuspiciousActivity(req, res, next) {
    const db = getDatabase();
    const ip = req.ip;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Count failed attempts in last 15 minutes
    const failedAttempts = db.prepare(`
    SELECT COUNT(*) as count FROM validation_attempts 
    WHERE ip_address = ? AND success = 0 AND attempted_at > ?
  `).get(ip, fifteenMinutesAgo);

    if (failedAttempts.count >= 10) {
        return res.status(429).json({
            error: 'Your IP has been temporarily blocked due to too many failed attempts. Please try again in 15 minutes.'
        });
    }

    next();
}

// Validate request body has required fields
function requireFields(...fields) {
    return (req, res, next) => {
        const missing = fields.filter(field => !req.body[field]);
        if (missing.length > 0) {
            return res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`
            });
        }
        next();
    };
}

// Sanitize and normalize card code
function normalizeCardCode(req, res, next) {
    if (req.body.code) {
        // Remove any extra whitespace, normalize format
        req.body.code = req.body.code
            .toString()
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '');

        // Validate format (with or without dashes)
        const codeWithoutDashes = req.body.code.replace(/-/g, '');
        if (!/^[A-Z0-9]{16}$/.test(codeWithoutDashes)) {
            return res.status(400).json({
                error: 'Invalid card code format'
            });
        }

        // Normalize to dashed format
        if (!req.body.code.includes('-')) {
            req.body.code = codeWithoutDashes.match(/.{1,4}/g).join('-');
        }
    }
    next();
}

// Add request metadata
function addRequestMetadata(req, res, next) {
    req.requestTime = new Date().toISOString();
    req.clientIp = req.ip || req.connection.remoteAddress;
    next();
}

module.exports = {
    apiLimiter,
    validationLimiter,
    loginLimiter,
    checkSuspiciousActivity,
    requireFields,
    normalizeCardCode,
    addRequestMetadata
};
