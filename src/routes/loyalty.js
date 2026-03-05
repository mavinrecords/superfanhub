const express = require('express');
const router = express.Router();
const loyaltyService = require('../services/loyaltyService');
const referralService = require('../services/referralService');
const loyaltyCardService = require('../services/loyaltyCardService');
const { validationLimiter, requireFields } = require('../middleware/security');
const { requireUser, optionalUser } = require('../middleware/requireUser');

// =============================================================
// AUTHENTICATED USER ENDPOINTS (SuperFan Hub)
// =============================================================

// Get current user's loyalty card
router.get('/card', requireUser, (req, res) => {
    try {
        const card = loyaltyCardService.getLoyaltyCard(req.user.id);

        if (!card) {
            return res.status(404).json({ error: 'No loyalty card found' });
        }

        res.json(card);
    } catch (error) {
        console.error('Loyalty card error:', error);
        res.status(500).json({ error: 'Failed to get loyalty card' });
    }
});

// Apply for a new loyalty card
router.post('/apply', requireUser, (req, res) => {
    try {
        const card = loyaltyCardService.applyForCard(req.user.id);
        res.status(201).json({
            success: true,
            message: 'Loyalty card created!',
            card
        });
    } catch (error) {
        console.error('Apply error:', error);
        if (error.message.includes('already')) {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to apply for card' });
    }
});

// Get points history
router.get('/history', requireUser, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const history = loyaltyCardService.getPointsHistory(req.user.id, limit);
        res.json(history);
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to get history' });
    }
});

// Get leaderboard
router.get('/leaderboard', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const leaderboard = loyaltyCardService.getLeaderboard(limit);
        res.json(leaderboard);
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// =============================================================
// LEGACY EMAIL-BASED ENDPOINTS (for compatibility)
// =============================================================

// Get loyalty profile
router.get('/profile/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const profile = loyaltyService.getLoyaltyProfile(email);
        const history = loyaltyService.getHistory(email);

        res.json({
            ...profile,
            tiers: loyaltyService.TIERS,
            history
        });
    } catch (error) {
        console.error('Loyalty profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Get referral info
router.get('/referral/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const codeInfo = referralService.getReferralCode(email);
        const stats = referralService.getReferralStats(email);

        res.json({
            code: codeInfo.code,
            stats
        });
    } catch (error) {
        console.error('Referral info error:', error);
        res.status(500).json({ error: 'Failed to get referral info' });
    }
});

// Claim referral code
router.post('/referral/claim',
    validationLimiter,
    requireFields('code', 'email'),
    async (req, res) => {
        try {
            const { code, email } = req.body;
            const result = referralService.processReferral(code, email);

            if (!result.valid) {
                return res.status(400).json({ error: result.error });
            }

            res.json({ success: true, referrer: result.referrer });
        } catch (error) {
            console.error('Referral claim error:', error);
            res.status(500).json({ error: 'Failed to claim referral' });
        }
    }
);

module.exports = router;

