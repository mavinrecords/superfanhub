/**
 * Tasks Routes - Mavin Community Task Master
 * User-facing task endpoints
 */

const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const streakService = require('../services/streakService');
const contributionService = require('../services/contributionService');
const taskFraudService = require('../services/taskFraudService');
const { runTransaction } = require('../db/database');
const { requireUser } = require('../middleware/requireUser');

// List available tasks (with user progress)
router.get('/', requireUser, (req, res) => {
    try {
        const { type, limit } = req.query;
        const tasks = taskService.getUserTasks(req.user.id, {
            type,
            limit: parseInt(limit) || 50
        });
        res.json(tasks);
    } catch (error) {
        console.error('List tasks error:', error);
        res.status(500).json({ error: 'Failed to list tasks' });
    }
});

// Get daily/weekly challenges
router.get('/daily', requireUser, (req, res) => {
    try {
        const { getDatabase } = require('../db/database');
        const db = getDatabase();
        const today = new Date().toISOString().split('T')[0];

        const challenges = db.prepare(`
            SELECT dc.*, t.title, t.description, t.type, t.points, t.difficulty, t.required_proof,
                t.image_url, t.artist_name,
                ts.status as user_status, ts.progress, ts.progress_target
            FROM daily_challenges dc
            JOIN tasks t ON dc.task_id = t.id
            LEFT JOIN task_submissions ts ON t.id = ts.task_id AND ts.user_id = ?
            WHERE dc.challenge_date = ? AND dc.is_active = 1
            ORDER BY dc.challenge_type, dc.bonus_points DESC
        `).all(req.user.id, today);

        res.json(challenges);
    } catch (error) {
        console.error('Daily challenges error:', error);
        res.status(500).json({ error: 'Failed to get challenges' });
    }
});

// Get streak info
router.get('/streaks', requireUser, (req, res) => {
    try {
        const streak = streakService.getStreakInfo(req.user.id);
        res.json(streak);
    } catch (error) {
        console.error('Streak error:', error);
        res.status(500).json({ error: 'Failed to get streak info' });
    }
});

// Get contribution score + fan tier
router.get('/contribution', requireUser, (req, res) => {
    try {
        const score = contributionService.getContributionScore(req.user.id);
        res.json(score);
    } catch (error) {
        console.error('Contribution error:', error);
        res.status(500).json({ error: 'Failed to get contribution score' });
    }
});

// Get task detail
router.get('/:id', requireUser, (req, res) => {
    try {
        const task = taskService.getTaskById(parseInt(req.params.id));
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({ error: 'Failed to get task' });
    }
});

// Start a task
router.post('/:id/start', requireUser, (req, res) => {
    try {
        const result = taskService.startTask(req.user.id, parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('Start task error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Submit proof for a task
router.post('/:id/submit', requireUser, (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const { proofType, proofData, proofUrl } = req.body;

        // Fraud check — block on medium severity and above
        const fraudCheck = taskFraudService.checkSubmissionFraud(req.user.id, taskId, proofData);
        if (fraudCheck.flagged && ['medium', 'high', 'critical'].includes(fraudCheck.severity)) {
            return res.status(403).json({
                error: 'Submission blocked due to suspicious activity',
                flags: fraudCheck.flags
            });
        }

        // Atomically submit proof, record streak, and recalculate tier
        const result = runTransaction(() => {
            const r = taskService.submitTaskProof(req.user.id, taskId, {
                proofType, proofData, proofUrl
            });
            streakService.recordDailyActivity(req.user.id);
            contributionService.recalculateTier(req.user.id);
            return r;
        });

        res.json(result);
    } catch (error) {
        console.error('Submit task error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Quick complete (for no-proof tasks)
router.post('/:id/complete', requireUser, (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const task = taskService.getTaskById(taskId);

        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (task.required_proof !== 'none') {
            return res.status(400).json({ error: 'This task requires proof submission' });
        }

        // Atomically complete task, record streak, and recalculate tier
        const result = runTransaction(() => {
            const r = taskService.completeTask(req.user.id, taskId, 'self');
            streakService.recordDailyActivity(req.user.id);
            contributionService.recalculateTier(req.user.id);
            return r;
        });

        res.json(result);
    } catch (error) {
        console.error('Complete task error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
