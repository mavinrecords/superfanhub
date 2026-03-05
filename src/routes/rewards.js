/**
 * Rewards Routes - Mavin Community Task Master
 * Catalog browsing and redemption
 */

const express = require('express');
const router = express.Router();
const rewardService = require('../services/rewardCatalogService');
const { requireUser } = require('../middleware/requireUser');

// List rewards catalog
router.get('/', requireUser, (req, res) => {
    try {
        const { category, limit, offset } = req.query;
        const rewards = rewardService.listRewards({
            category,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });
        res.json(rewards);
    } catch (error) {
        console.error('List rewards error:', error);
        res.status(500).json({ error: 'Failed to list rewards' });
    }
});

// Get user's redemption history
router.get('/my', requireUser, (req, res) => {
    try {
        const redemptions = rewardService.getUserRedemptions(req.user.id);
        res.json(redemptions);
    } catch (error) {
        console.error('Get redemptions error:', error);
        res.status(500).json({ error: 'Failed to get redemptions' });
    }
});

// Get reward detail
router.get('/:id', requireUser, (req, res) => {
    try {
        const reward = rewardService.getRewardById(parseInt(req.params.id));
        if (!reward) return res.status(404).json({ error: 'Reward not found' });
        res.json(reward);
    } catch (error) {
        console.error('Get reward error:', error);
        res.status(500).json({ error: 'Failed to get reward' });
    }
});

// Redeem a reward
router.post('/:id/redeem', requireUser, (req, res) => {
    try {
        const result = rewardService.redeemReward(req.user.id, parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('Redeem error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
