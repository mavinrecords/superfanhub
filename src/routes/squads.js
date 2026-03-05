/**
 * Squads Routes - Mavin Community Task Master
 * Squad management and team missions
 */

const express = require('express');
const router = express.Router();
const squadService = require('../services/squadService');
const { requireUser } = require('../middleware/requireUser');

// Get user's squads
router.get('/my', requireUser, (req, res) => {
    try {
        const squads = squadService.getUserSquads(req.user.id);
        res.json(squads);
    } catch (error) {
        console.error('Get squads error:', error);
        res.status(500).json({ error: 'Failed to get squads' });
    }
});

// List available squads
router.get('/', requireUser, (req, res) => {
    try {
        const { artistId, limit } = req.query;
        const squads = squadService.listSquads({
            artistId,
            limit: parseInt(limit) || 20
        });
        res.json(squads);
    } catch (error) {
        console.error('List squads error:', error);
        res.status(500).json({ error: 'Failed to list squads' });
    }
});

// Get squad detail
router.get('/:id', requireUser, (req, res) => {
    try {
        const squad = squadService.getSquadById(parseInt(req.params.id));
        if (!squad) return res.status(404).json({ error: 'Squad not found' });
        res.json(squad);
    } catch (error) {
        console.error('Get squad error:', error);
        res.status(500).json({ error: 'Failed to get squad' });
    }
});

// Join a squad
router.post('/:id/join', requireUser, (req, res) => {
    try {
        const result = squadService.joinSquad(req.user.id, parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('Join squad error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Leave a squad
router.post('/:id/leave', requireUser, (req, res) => {
    try {
        const result = squadService.leaveSquad(req.user.id, parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('Leave squad error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get squad missions
router.get('/:id/missions', requireUser, (req, res) => {
    try {
        const squad = squadService.getSquadById(parseInt(req.params.id));
        if (!squad) return res.status(404).json({ error: 'Squad not found' });
        res.json(squad.missions);
    } catch (error) {
        console.error('Squad missions error:', error);
        res.status(500).json({ error: 'Failed to get missions' });
    }
});

module.exports = router;
