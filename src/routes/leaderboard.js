/**
 * Leaderboard Routes - Mavin Community Task Master
 * Global and artist-specific leaderboards
 */

const express = require('express');
const router = express.Router();
const leaderboardService = require('../services/leaderboardService');
const { requireUser } = require('../middleware/requireUser');

// Get global leaderboard
router.get('/', requireUser, (req, res) => {
    try {
        const { period, limit } = req.query;
        const leaderboard = leaderboardService.getLeaderboard({
            scope: 'global',
            period: period || 'all_time',
            limit: parseInt(limit) || 25
        });

        // Get user's own rank
        const myRank = leaderboardService.getUserRank(req.user.id);

        res.json({ leaderboard, myRank });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// Get artist-specific leaderboard
router.get('/artist/:artistId', requireUser, (req, res) => {
    try {
        const { period, limit } = req.query;
        const leaderboard = leaderboardService.getLeaderboard({
            scope: 'artist',
            scopeId: req.params.artistId,
            period: period || 'all_time',
            limit: parseInt(limit) || 25
        });

        const myRank = leaderboardService.getUserRank(req.user.id, 'artist', req.params.artistId);

        res.json({ leaderboard, myRank });
    } catch (error) {
        console.error('Artist leaderboard error:', error);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

module.exports = router;
