const express = require('express');
const router = express.Router();
const cardService = require('../services/cardService');
const themeService = require('../services/themeService');
const shareService = require('../services/shareService');
const { getDatabase } = require('../db/database');
const {
    validationLimiter,
    checkSuspiciousActivity,
    requireFields,
    normalizeCardCode
} = require('../middleware/security');
const { requireUser } = require('../middleware/requireUser');

/**
 * Record a validation attempt for rate-limiting / suspicious activity detection.
 * The checkSuspiciousActivity middleware reads this table; nothing was writing to it before.
 */
function recordValidationAttempt(ip, code, success) {
    try {
        const db = getDatabase();
        const codePrefix = code ? String(code).substring(0, 4) : null;
        db.prepare(
            `INSERT INTO validation_attempts (ip_address, code_prefix, attempted_at, success)
             VALUES (?, ?, datetime('now'), ?)`
        ).run(ip, codePrefix, success ? 1 : 0);
    } catch (e) {
        // Non-fatal — don't let logging failure break card validation
        console.error('Failed to record validation attempt:', e.message);
    }
}

// ... existing routes ...

// Get available themes
router.get('/themes', (req, res) => {
    res.json(themeService.getThemes());
});

// Update card theme
router.post('/theme',
    validationLimiter,
    requireFields('code', 'themeId'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code, themeId } = req.body;
            // First validate card exists and is active
            const result = await cardService.validateCard(code, req.clientIp);
            if (!result.valid) {
                return res.status(400).json({ error: 'Invalid card' });
            }

            const db = require('../db/database').getDatabase();
            const update = themeService.applyThemeToCard(result.card.id, themeId, db);
            res.json(update);
        } catch (error) {
            console.error('Theme update error:', error);
            res.status(500).json({ error: 'Failed to update theme' });
        }
    }
);

// Create share link
router.post('/share',
    validationLimiter,
    requireFields('code', 'senderName'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code, senderName, recipientName, message, email } = req.body;
            const result = await cardService.validateCard(code, req.clientIp);

            if (!result.valid) {
                return res.status(400).json({ error: 'Invalid card' });
            }

            const share = shareService.createShareLink(
                result.card.id,
                senderName,
                recipientName,
                message
            );

            // Send email if provided
            if (email) {
                await shareService.sendShareEmail(email, share, result.card);
            }

            res.json({ success: true, shareUrl: share.url, expiresAt: share.expiresAt });
        } catch (error) {
            console.error('Share error:', error);
            res.status(500).json({ error: 'Failed to create share link' });
        }
    }
);



// Wallet Pass Endpoints
router.get('/wallet/pass/apple',
    validationLimiter,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code } = req.query;
            const result = await cardService.validateCard(code, req.clientIp);
            if (!result.valid) return res.status(400).json({ error: 'Invalid card' });

            const walletService = require('../services/walletService');
            const passData = walletService.generateApplePassJSON(result.card);

            res.json(passData);
        } catch (error) {
            console.error('Apple Pass Error:', error);
            res.status(500).json({ error: 'Failed to generate pass' });
        }
    }
);

router.get('/wallet/pass/google',
    validationLimiter,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code } = req.query;
            const result = await cardService.validateCard(code, req.clientIp);
            if (!result.valid) return res.status(400).json({ error: 'Invalid card' });

            const walletService = require('../services/walletService');
            const passData = walletService.generateGooglePassObject(result.card);

            res.json(passData);
        } catch (error) {
            console.error('Google Pass Error:', error);
            res.status(500).json({ error: 'Failed to generate pass' });
        }
    }
);

// Validate a gift card code
router.post('/validate',
    validationLimiter,
    checkSuspiciousActivity,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const result = await cardService.validateCard(req.body.code, req.clientIp);

            if (!result.valid) {
                recordValidationAttempt(req.clientIp, req.body.code, false);
                return res.status(400).json({
                    valid: false,
                    error: result.error
                });
            }

            recordValidationAttempt(req.clientIp, req.body.code, true);
            res.json({
                valid: true,
                card: result.card
            });
        } catch (error) {
            console.error('Validation error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Redeem value from a gift card
router.post('/redeem',
    validationLimiter,
    checkSuspiciousActivity,
    requireFields('code', 'amount'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code, amount, notes } = req.body;
            const numAmount = parseFloat(amount);

            if (isNaN(numAmount) || numAmount <= 0) {
                return res.status(400).json({ error: 'Invalid amount' });
            }

            const result = await cardService.redeemValue(
                code,
                numAmount,
                'customer',
                req.clientIp,
                notes
            );

            if (!result.success) {
                recordValidationAttempt(req.clientIp, code, false);
                return res.status(400).json({ error: result.error });
            }

            recordValidationAttempt(req.clientIp, code, true);
            res.json(result);
        } catch (error) {
            console.error('Redemption error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Apply discount to a ticket
router.post('/apply-discount',
    validationLimiter,
    checkSuspiciousActivity,
    requireFields('code', 'ticketAmount', 'ticketId'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const { code, ticketAmount, ticketId } = req.body;
            const numAmount = parseFloat(ticketAmount);

            if (isNaN(numAmount) || numAmount <= 0) {
                return res.status(400).json({ error: 'Invalid ticket amount' });
            }

            const result = await cardService.applyDiscount(
                code,
                numAmount,
                ticketId,
                'customer',
                req.clientIp
            );

            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json(result);
        } catch (error) {
            console.error('Discount application error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Get card balance (simple check without full validation)
router.post('/check-balance',
    validationLimiter,
    checkSuspiciousActivity,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const result = await cardService.validateCard(req.body.code, req.clientIp);

            if (!result.valid) {
                return res.status(400).json({ error: result.error });
            }

            const card = result.card;
            res.json({
                codePrefix: card.codePrefix,
                tier: card.tier,
                cardType: card.cardType,
                balance: card.currentBalance,
                discountPercent: card.discountPercent,
                discountUsesRemaining: card.discountUsesRemaining,
                expiresAt: card.expiresAt
            });
        } catch (error) {
            console.error('Balance check error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Get redemption history for a card
router.post('/history',
    validationLimiter,
    checkSuspiciousActivity,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const result = await cardService.validateCard(req.body.code, req.clientIp);

            if (!result.valid) {
                return res.status(400).json({ error: result.error });
            }

            const history = cardService.getCardHistory(result.card.id);

            res.json({
                card: result.card,
                transactions: history.map(t => ({
                    id: t.id,
                    type: t.type,
                    amount: t.amount,
                    discountApplied: t.discount_applied,
                    ticketId: t.ticket_id,
                    ticketAmount: t.ticket_amount,
                    performedAt: t.performed_at,
                    notes: t.notes
                }))
            });
        } catch (error) {
            console.error('History error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Link a card to user account
router.post('/link',
    requireUser,
    validationLimiter,
    requireFields('code'),
    normalizeCardCode,
    async (req, res) => {
        try {
            const result = cardService.linkCardToUser(req.user.id, req.body.code);

            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ success: true, cardId: result.cardId });
        } catch (error) {
            console.error('Link card error:', error);
            res.status(500).json({ error: 'Failed to link card' });
        }
    }
);

// Get user's cards
router.get('/my-cards',
    requireUser,
    async (req, res) => {
        try {
            const cards = cardService.getUserCards(req.user.id);
            res.json({ cards });
        } catch (error) {
            console.error('Get user cards error:', error);
            res.status(500).json({ error: 'Failed to get your cards' });
        }
    }
);

module.exports = router;
