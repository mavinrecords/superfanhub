const express = require('express');
const router = express.Router();
const campaignService = require('../services/campaignService');
const { requireUser } = require('../middleware/requireUser');
const { requireAdmin } = require('../middleware/auth');
const { requireFields } = require('../middleware/security');

// =============================================================
// PUBLIC / USER ROUTES
// =============================================================

// List active campaigns
router.get('/', requireUser, (req, res) => {
    try {
        const { type } = req.query;
        // Logic check: User might want to see all or just active. 
        // For My Campaigns view, we likely want to see their specific status.
        // Let's return all active campaigns by default
        const campaigns = campaignService.listCampaigns({ status: 'active', type });
        res.json(campaigns);
    } catch (error) {
        console.error('List campaigns error:', error);
        res.status(500).json({ error: 'Failed to list campaigns' });
    }
});

// Get my campaigns (with status)
router.get('/my', requireUser, (req, res) => {
    try {
        const campaigns = campaignService.getUserCampaigns(req.user.id);
        res.json(campaigns);
    } catch (error) {
        console.error('Get my campaigns error:', error);
        res.status(500).json({ error: 'Failed to get your campaigns' });
    }
});

// Get campaign details
router.get('/:id', requireUser, (req, res) => {
    try {
        const campaign = campaignService.getCampaignById(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        res.json(campaign);
    } catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ error: 'Failed to get campaign' });
    }
});

// Join a campaign
router.post('/:id/join', requireUser, (req, res) => {
    try {
        const result = campaignService.joinCampaign(req.user.id, req.params.id);
        res.json(result);
    } catch (error) {
        console.error('Join campaign error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Complete a campaign
// Note: In a real system, this might be triggered by a webhook or internal event.
// For MVP/Simulation, we allow users to trigger it for "Manual" type campaigns or admins to trigger it.
// To prevent abuse, we'll verify it's a "simulated" or "social" campaign that trusts client side for MVP,
// OR require admin/system token. For now, let's assume it's like a "Check-in" button.
router.post('/:id/complete', requireUser, (req, res) => {
    try {
        const { proof } = req.body;
        const result = campaignService.completeCampaign(req.user.id, req.params.id, proof);
        res.json(result);
    } catch (error) {
        console.error('Complete campaign error:', error);
        res.status(400).json({ error: error.message });
    }
});

// =============================================================
// ADMIN ROUTES
// =============================================================

// List all campaigns (Admin)
router.get('/manage', requireAdmin, (req, res) => {
    try {
        const campaigns = campaignService.listCampaigns({});
        res.json(campaigns);
    } catch (error) {
        console.error('Admin list campaigns error:', error);
        res.status(500).json({ error: 'Failed to list campaigns' });
    }
});

// Create campaign
router.post('/',
    requireAdmin,
    requireFields('title', 'type', 'points'),
    (req, res) => {
        try {
            const campaign = campaignService.createCampaign({
                ...req.body,
                createdBy: req.admin.username
            });
            res.status(201).json(campaign);
        } catch (error) {
            console.error('Create campaign error:', error);
            res.status(500).json({ error: 'Failed to create campaign' });
        }
    }
);

// Update campaign
router.put('/:id', requireAdmin, (req, res) => {
    try {
        const campaign = campaignService.updateCampaign(req.params.id, req.body);
        res.json(campaign);
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

module.exports = router;
