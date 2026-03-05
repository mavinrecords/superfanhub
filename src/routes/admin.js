const express = require('express');
const router = express.Router();
const cardService = require('../services/cardService');
const qrService = require('../services/qrService');
const analyticsService = require('../services/analyticsService');
const { requireAdmin, login, logout, checkSession, changePassword } = require('../middleware/auth');
const { loginLimiter, requireFields } = require('../middleware/security');

// Auth routes
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/session', checkSession);
router.post('/change-password', requireAdmin, changePassword);

// Dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
    try {
        const stats = cardService.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Analytics dashboard data
router.get('/analytics', requireAdmin, (req, res) => {
    try {
        const period = req.query.period || '30d';
        const analytics = analyticsService.getAnalytics(period);
        res.json(analytics);
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export cards CSV
router.get('/export/cards', requireAdmin, (req, res) => {
    try {
        const importExportService = require('../services/importExportService');
        const { status, tier, cardType } = req.query;
        const csv = importExportService.exportCardsToCSV({ status, tier, cardType });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="gift-cards-export.csv"');
        res.send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Export transactions CSV
router.get('/export/transactions', requireAdmin, (req, res) => {
    try {
        const importExportService = require('../services/importExportService');
        const { type, startDate, endDate } = req.query;
        const csv = importExportService.exportTransactionsToCSV({ type, startDate, endDate });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="transactions-export.csv"');
        res.send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Import cards from CSV
router.post('/import/cards', requireAdmin, async (req, res) => {
    try {
        const importExportService = require('../services/importExportService');
        const { csvContent } = req.body;

        if (!csvContent) {
            return res.status(400).json({ error: 'CSV content required' });
        }

        const result = await importExportService.importCardsFromCSV(csvContent, req.session.user.username);
        res.json(result);
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: 'Import failed' });
    }
});

// Fraud detection alerts
router.get('/alerts', requireAdmin, (req, res) => {
    try {
        const fraudService = require('../services/fraudService');
        const alerts = fraudService.getAlerts();
        const summary = fraudService.getFraudSummary();
        res.json({ alerts, summary });
    } catch (error) {
        console.error('Fraud alerts error:', error);
        res.status(500).json({ error: 'Failed to get alerts' });
    }
});

// Create promotional campaign (bulk generate discount cards)
router.post('/campaigns', requireAdmin, (req, res) => {
    try {
        const { name, discountPercent, maxUses, count, prefix, expiresAt } = req.body;

        if (!name || !discountPercent || !count) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const promoService = require('../services/promoService');
        const campaign = promoService.createCampaign(name, discountPercent, maxUses, expiresAt);
        const result = promoService.generatePromoCodes(campaign, count, prefix || 'PROMO');

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Campaign creation error:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// List all cards with filters
router.get('/cards', requireAdmin, (req, res) => {
    try {
        const { status, tier, cardType, limit, offset } = req.query;
        const result = cardService.getCards({
            status,
            tier,
            cardType,
            limit: parseInt(limit) || 100,
            offset: parseInt(offset) || 0
        });
        res.json(result);
    } catch (error) {
        console.error('List cards error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single card by ID
router.get('/cards/:id', requireAdmin, (req, res) => {
    try {
        const card = cardService.getCardById(parseInt(req.params.id));
        if (!card) {
            return res.status(404).json({ error: 'Card not found' });
        }
        res.json(card);
    } catch (error) {
        console.error('Get card error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Generate QR code for a card
router.get('/cards/:id/qr', requireAdmin, async (req, res) => {
    try {
        const card = cardService.getCardById(parseInt(req.params.id));
        if (!card) {
            return res.status(404).json({ error: 'Card not found' });
        }

        // QR code contains a link to the redemption page with card ID reference
        // The user will still need to enter their code, but this helps identify the card
        const redemptionUrl = `${process.env.BASE_URL || 'http://localhost:3000'}`;

        const format = req.query.format || 'dataurl';

        if (format === 'png') {
            const buffer = await qrService.generateQRCodeBuffer(redemptionUrl);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Disposition', `attachment; filename="giftcard-${card.code_prefix}.png"`);
            res.send(buffer);
        } else {
            const dataUrl = await qrService.generateQRCode(redemptionUrl);
            res.json({
                qrCode: dataUrl,
                cardId: card.id,
                codePrefix: card.code_prefix,
                redemptionUrl
            });
        }
    } catch (error) {
        console.error('QR code generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Issue a new card
router.post('/cards',
    requireAdmin,
    requireFields('tier', 'cardType'),
    async (req, res) => {
        try {
            const {
                tier,
                cardType,
                initialValue,
                discountPercent,
                discountUsesRemaining,
                expiresAt,
                metadata
            } = req.body;

            // Validate card type requirements
            if (cardType === 'value' && (!initialValue || initialValue <= 0)) {
                return res.status(400).json({ error: 'Value cards require a positive initial value' });
            }

            if (cardType === 'discount' && (!discountPercent || discountPercent <= 0)) {
                return res.status(400).json({ error: 'Discount cards require a positive discount percentage' });
            }

            if (cardType === 'hybrid') {
                if (!initialValue || initialValue <= 0) {
                    return res.status(400).json({ error: 'Hybrid cards require a positive initial value' });
                }
                if (!discountPercent || discountPercent <= 0) {
                    return res.status(400).json({ error: 'Hybrid cards require a positive discount percentage' });
                }
            }

            const card = await cardService.issueCard({
                tier,
                cardType,
                initialValue: parseFloat(initialValue) || 0,
                discountPercent: parseFloat(discountPercent) || 0,
                discountUsesRemaining: discountUsesRemaining !== undefined ? parseInt(discountUsesRemaining) : null,
                expiresAt: expiresAt || null,
                issuedBy: req.admin.username,
                metadata,
                ipAddress: req.clientIp
            });

            res.status(201).json(card);
        } catch (error) {
            console.error('Issue card error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Bulk issue cards
router.post('/cards/bulk',
    requireAdmin,
    requireFields('tier', 'cardType', 'quantity'),
    async (req, res) => {
        try {
            const {
                tier,
                cardType,
                initialValue,
                discountPercent,
                discountUsesRemaining,
                expiresAt,
                quantity
            } = req.body;

            const numQuantity = parseInt(quantity);
            if (isNaN(numQuantity) || numQuantity < 1 || numQuantity > 100) {
                return res.status(400).json({ error: 'Quantity must be between 1 and 100' });
            }

            const cards = [];
            for (let i = 0; i < numQuantity; i++) {
                const card = await cardService.issueCard({
                    tier,
                    cardType,
                    initialValue: parseFloat(initialValue) || 0,
                    discountPercent: parseFloat(discountPercent) || 0,
                    discountUsesRemaining: discountUsesRemaining !== undefined ? parseInt(discountUsesRemaining) : null,
                    expiresAt: expiresAt || null,
                    issuedBy: req.admin.username,
                    ipAddress: req.clientIp
                });
                cards.push(card);
            }

            res.status(201).json({
                success: true,
                count: cards.length,
                cards
            });
        } catch (error) {
            console.error('Bulk issue error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// Freeze a card
router.post('/cards/:id/freeze', requireAdmin, (req, res) => {
    try {
        const result = cardService.freezeCard(
            parseInt(req.params.id),
            req.admin.username,
            req.clientIp,
            req.body.notes
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Freeze card error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Unfreeze a card
router.post('/cards/:id/unfreeze', requireAdmin, (req, res) => {
    try {
        const result = cardService.unfreezeCard(
            parseInt(req.params.id),
            req.admin.username,
            req.clientIp,
            req.body.notes
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Unfreeze card error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Revoke a card
router.post('/cards/:id/revoke', requireAdmin, (req, res) => {
    try {
        const result = cardService.revokeCard(
            parseInt(req.params.id),
            req.admin.username,
            req.clientIp,
            req.body.notes
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Revoke card error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get transactions (audit log)
router.get('/transactions', requireAdmin, (req, res) => {
    try {
        const { cardId, type, limit, offset } = req.query;
        const result = cardService.getTransactions({
            cardId: cardId ? parseInt(cardId) : null,
            type,
            limit: parseInt(limit) || 100,
            offset: parseInt(offset) || 0
        });
        res.json(result);
    } catch (error) {
        console.error('List transactions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export cards as CSV
router.get('/cards/export/csv', requireAdmin, (req, res) => {
    try {
        const { status, tier, cardType } = req.query;
        const result = cardService.getCards({
            status,
            tier,
            cardType,
            limit: 10000,
            offset: 0
        });

        const headers = ['ID', 'Code Prefix', 'Tier', 'Type', 'Initial Value', 'Current Balance',
            'Discount %', 'Uses Remaining', 'Status', 'Issued By', 'Issued At', 'Expires At'];

        let csv = headers.join(',') + '\n';

        for (const card of result.cards) {
            csv += [
                card.id,
                card.code_prefix,
                card.tier,
                card.card_type,
                card.initial_value,
                card.current_balance,
                card.discount_percent,
                card.discount_uses_remaining ?? 'unlimited',
                card.status,
                card.issued_by,
                card.issued_at,
                card.expires_at || 'never'
            ].join(',') + '\n';
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=gift_cards_export.csv');
        res.send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =============================================================
// SUPERFAN USER MANAGEMENT
// =============================================================

const { getDatabase } = require('../db/database');
const loyaltyCardService = require('../services/loyaltyCardService');

// Get all SuperFan users
router.get('/superfans', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const { search, tier, limit = 50, offset = 0 } = req.query;

        let query = `
            SELECT u.id, u.email, u.name, u.phone, u.is_verified, u.created_at,
                   lc.card_number, lc.tier, lc.points, lc.lifetime_points, lc.status as card_status
            FROM users u
            LEFT JOIN loyalty_cards lc ON u.id = lc.user_id
            WHERE 1=1
        `;
        const params = [];

        if (search) {
            query += ` AND (u.name LIKE ? OR u.email LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (tier) {
            query += ` AND lc.tier = ?`;
            params.push(tier);
        }

        query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const users = db.prepare(query).all(...params);

        // Get total count
        let countQuery = `SELECT COUNT(*) as total FROM users u LEFT JOIN loyalty_cards lc ON u.id = lc.user_id WHERE 1=1`;
        const countParams = [];
        if (search) {
            countQuery += ` AND (u.name LIKE ? OR u.email LIKE ?)`;
            countParams.push(`%${search}%`, `%${search}%`);
        }
        if (tier) {
            countQuery += ` AND lc.tier = ?`;
            countParams.push(tier);
        }

        const { total } = db.prepare(countQuery).get(...countParams);

        res.json({ users, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
        console.error('SuperFans list error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Get SuperFan stats
router.get('/superfans/stats', requireAdmin, (req, res) => {
    try {
        const stats = loyaltyCardService.getCardStats();
        const db = getDatabase();

        const userStats = db.prepare(`
            SELECT
                COUNT(*) as total_users,
                SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_users,
                COUNT(DISTINCT CASE 
                    WHEN datetime(created_at) > datetime('now', '-7 days') THEN id 
                END) as new_this_week
            FROM users
        `).get();

        res.json({
            ...stats,
            ...userStats
        });
    } catch (error) {
        console.error('SuperFan stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Get single SuperFan user detail
router.get('/superfans/:id', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const userId = parseInt(req.params.id);

        const user = db.prepare(`
            SELECT u.*, up.avatar_url, up.bio, up.favorite_artist,
                   lc.id as loyalty_card_id, lc.card_number, lc.tier, lc.points, 
                   lc.lifetime_points, lc.status as card_status, lc.issued_at,
                   sc.spotify_user_id, sc.created_at as spotify_connected_at
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN loyalty_cards lc ON u.id = lc.user_id
            LEFT JOIN spotify_connections sc ON u.id = sc.user_id
            WHERE u.id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get activity history
        const activity = db.prepare(`
            SELECT * FROM loyalty_transactions
            WHERE email = ?
            ORDER BY created_at DESC
            LIMIT 20
        `).all(user.email);

        res.json({ user, activity });
    } catch (error) {
        console.error('SuperFan detail error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Manually add points to a user
router.post('/superfans/:id/points', requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { amount, description } = req.body;

        if (!amount || typeof amount !== 'number') {
            return res.status(400).json({ error: 'Amount is required' });
        }

        const result = loyaltyCardService.addPoints(
            userId,
            amount,
            description || `Admin adjustment by ${req.admin.username}`,
            'admin'
        );

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Add points error:', error);
        res.status(500).json({ error: error.message || 'Failed to add points' });
    }
});

// Suspend/unsuspend a user's loyalty card
router.post('/superfans/:id/toggle-status', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const userId = parseInt(req.params.id);

        const card = db.prepare('SELECT id, status FROM loyalty_cards WHERE user_id = ?').get(userId);

        if (!card) {
            return res.status(404).json({ error: 'User has no loyalty card' });
        }

        const newStatus = card.status === 'active' ? 'suspended' : 'active';

        db.prepare(`
            UPDATE loyalty_cards SET status = ?, updated_at = datetime('now') WHERE id = ?
        `).run(newStatus, card.id);

        res.json({ success: true, newStatus });
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Get leaderboard
router.get('/superfans/leaderboard', requireAdmin, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const leaderboard = loyaltyCardService.getLeaderboard(limit);
        res.json(leaderboard);
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// =============================================================
// COMMUNITY TASK MASTER — ADMIN ENDPOINTS
// =============================================================

const taskService = require('../services/taskService');
const rewardCatalogService = require('../services/rewardCatalogService');
const leaderboardService = require('../services/leaderboardService');
const squadService = require('../services/squadService');
const taskFraudService = require('../services/taskFraudService');
const contributionService = require('../services/contributionService');
const proofService = require('../services/proofService');

// ─── TASK MANAGEMENT ────────────────────────────────────────

// Get task stats
router.get('/tasks/stats', requireAdmin, (req, res) => {
    try {
        const stats = taskService.getTaskStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get task stats' });
    }
});

// List all tasks
router.get('/tasks', requireAdmin, (req, res) => {
    try {
        const { status, type, limit, offset } = req.query;
        const tasks = taskService.listTasks({
            status, type,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list tasks' });
    }
});

// Create task
router.post('/tasks', requireAdmin, (req, res) => {
    try {
        const task = taskService.createTask({
            ...req.body,
            createdBy: req.admin.username
        });
        res.status(201).json(task);
    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update task
router.put('/tasks/:id', requireAdmin, (req, res) => {
    try {
        const task = taskService.updateTask(parseInt(req.params.id), req.body);
        res.json(task);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});

// Delete task
router.delete('/tasks/:id', requireAdmin, (req, res) => {
    try {
        taskService.deleteTask(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete task' });
    }
});

// ─── CAMPAIGN MULTIPLIERS ───────────────────────────────────

router.get('/multipliers', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const multipliers = db.prepare('SELECT * FROM campaign_multipliers ORDER BY created_at DESC').all();
        res.json(multipliers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get multipliers' });
    }
});

router.post('/multipliers', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const { title, multiplier, appliesTo, artistId, startDate, endDate, campaignId } = req.body;
        const result = db.prepare(`
            INSERT INTO campaign_multipliers (campaign_id, title, multiplier, applies_to, artist_id, start_date, end_date, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(campaignId || null, title, multiplier || 1.5, appliesTo || 'all', artistId || null, startDate, endDate, req.admin.username);

        const created = db.prepare('SELECT * FROM campaign_multipliers WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(created);
    } catch (error) {
        console.error('Create multiplier error:', error);
        res.status(500).json({ error: 'Failed to create multiplier' });
    }
});

router.delete('/multipliers/:id', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        db.prepare('DELETE FROM campaign_multipliers WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete multiplier' });
    }
});

// ─── FRAUD MONITORING ───────────────────────────────────────

router.get('/task-fraud', requireAdmin, (req, res) => {
    try {
        const summary = taskFraudService.getTaskFraudSummary();
        const flags = taskFraudService.getUnresolvedFlags({ limit: 50 });
        res.json({ summary, flags });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get fraud data' });
    }
});

router.post('/task-fraud/:id/resolve', requireAdmin, (req, res) => {
    try {
        taskFraudService.resolveFlag(parseInt(req.params.id), req.admin.username);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to resolve flag' });
    }
});

// ─── VERIFICATION QUEUE ─────────────────────────────────────

router.get('/verifications', requireAdmin, (req, res) => {
    try {
        const pending = proofService.getPendingVerifications(50);
        res.json(pending);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get verifications' });
    }
});

router.post('/verifications/:id/review', requireAdmin, (req, res) => {
    try {
        const { result, notes } = req.body;
        const item = proofService.processVerification(
            parseInt(req.params.id), result, req.admin.username, notes
        );

        // If approved, complete the task
        if (result === 'approved' && item) {
            taskService.completeTask(item.user_id, item.task_id, req.admin.username);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Review error:', error);
        res.status(500).json({ error: 'Failed to process review' });
    }
});

// ─── REWARD INVENTORY ───────────────────────────────────────

router.get('/rewards/stats', requireAdmin, (req, res) => {
    try {
        const stats = rewardCatalogService.getRewardStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get reward stats' });
    }
});

router.get('/rewards', requireAdmin, (req, res) => {
    try {
        const rewards = rewardCatalogService.listRewards({ isActive: undefined, limit: 100 });
        res.json(rewards);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list rewards' });
    }
});

router.post('/rewards', requireAdmin, (req, res) => {
    try {
        const reward = rewardCatalogService.createReward(req.body);
        res.status(201).json(reward);
    } catch (error) {
        console.error('Create reward error:', error);
        res.status(500).json({ error: 'Failed to create reward' });
    }
});

router.put('/rewards/:id', requireAdmin, (req, res) => {
    try {
        const reward = rewardCatalogService.updateReward(parseInt(req.params.id), req.body);
        res.json(reward);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update reward' });
    }
});

// ─── FAN ANALYTICS ──────────────────────────────────────────

router.get('/fan-analytics', requireAdmin, (req, res) => {
    try {
        const db = getDatabase();
        const stats = taskService.getTaskStats();
        const tierDistribution = db.prepare(`
            SELECT current_tier, COUNT(*) as count FROM contribution_scores GROUP BY current_tier
        `).all();
        const topFans = db.prepare(`
            SELECT cs.*, u.name, u.email FROM contribution_scores cs
            JOIN users u ON cs.user_id = u.id
            ORDER BY cs.total_score DESC LIMIT 10
        `).all();
        const rewardStats = rewardCatalogService.getRewardStats();

        res.json({ taskStats: stats, tierDistribution, topFans, rewardStats });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get fan analytics' });
    }
});

// ─── LEADERBOARD MODERATION ─────────────────────────────────

router.post('/leaderboard/refresh', requireAdmin, (req, res) => {
    try {
        const result = leaderboardService.refreshAllLeaderboards();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh leaderboards' });
    }
});

// ─── SQUAD MANAGEMENT ───────────────────────────────────────

router.post('/squads', requireAdmin, (req, res) => {
    try {
        const squad = squadService.createSquad(req.body);
        res.status(201).json(squad);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create squad' });
    }
});

router.post('/squads/:id/missions', requireAdmin, (req, res) => {
    try {
        const mission = squadService.createSquadMission({
            squadId: parseInt(req.params.id),
            ...req.body
        });
        res.status(201).json(mission);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create squad mission' });
    }
});

module.exports = router;
