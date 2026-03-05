/**
 * Scheduler Service
 * Handles scheduled tasks like expiry reminders
 */

const cron = require('node-cron');
const { getDatabase } = require('../db/database');
const emailService = require('./emailService');

/**
 * Initialize all scheduled tasks
 */
function initScheduler() {
    console.log('📅 Initializing scheduler...');

    // Run expiry check daily at 9 AM
    cron.schedule('0 9 * * *', () => {
        console.log('Running daily expiry reminder check...');
        checkExpiringCards();
    });

    // ─── TASK MASTER CRON JOBS ──────────────────────────

    // Auto-expire tasks daily at midnight
    cron.schedule('0 0 * * *', () => {
        console.log('Running task auto-expiry...');
        autoExpireTasks();
    });

    // Generate daily challenges at 6 AM
    cron.schedule('0 6 * * *', () => {
        console.log('Generating daily challenges...');
        generateDailyChallenges();
    });

    // Generate weekly challenges on Monday at 6 AM
    cron.schedule('0 6 * * 1', () => {
        console.log('Generating weekly challenges...');
        generateWeeklyChallenges();
    });

    // Recalculate tiers every 6 hours
    cron.schedule('0 */6 * * *', () => {
        console.log('Recalculating fan tiers...');
        try {
            const { recalculateAllTiers } = require('./contributionService');
            const result = recalculateAllTiers();
            console.log(`Tier recalc: ${result.processed} users, ${result.promotions} promotions`);
        } catch (e) { console.error('Tier recalc error:', e); }
    });

    // Refresh leaderboards every 2 hours
    cron.schedule('0 */2 * * *', () => {
        console.log('Refreshing leaderboards...');
        try {
            const { refreshAllLeaderboards } = require('./leaderboardService');
            const result = refreshAllLeaderboards();
            console.log(`Leaderboards refreshed: ${result.refreshed}`);
        } catch (e) { console.error('Leaderboard refresh error:', e); }
    });

    // Reset broken streaks at 1 AM
    cron.schedule('0 1 * * *', () => {
        console.log('Resetting broken streaks...');
        try {
            const { resetBrokenStreaks } = require('./streakService');
            const result = resetBrokenStreaks();
            console.log(`Broken streaks reset: ${result.brokenStreaks}`);
        } catch (e) { console.error('Streak reset error:', e); }
    });

    // Also run on server start (for testing)
    if (process.env.RUN_EXPIRY_CHECK_ON_START === 'true') {
        checkExpiringCards();
    }

    console.log('📅 Scheduler initialized — all cron jobs active');
}


/**
 * Check for cards expiring soon and send reminders
 */
async function checkExpiringCards() {
    const db = getDatabase();

    try {
        // Find cards expiring in 7, 3, or 1 days with balance > 0
        const now = new Date();
        const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const oneDay = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

        const expiringCards = db.prepare(`
            SELECT * FROM gift_cards 
            WHERE status = 'active' 
            AND current_balance > 0
            AND expires_at IS NOT NULL
            AND DATE(expires_at) IN (DATE(?), DATE(?), DATE(?))
        `).all(
            sevenDays.toISOString(),
            threeDays.toISOString(),
            oneDay.toISOString()
        );

        console.log(`Found ${expiringCards.length} cards needing expiry reminders`);

        for (const card of expiringCards) {
            const expiryDate = new Date(card.expires_at);
            const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

            // Check if reminder already sent today
            const reminderKey = `expiry_reminder_${card.id}_${daysLeft}`;
            const alreadySent = db.prepare(`
                SELECT 1 FROM reminder_log 
                WHERE card_id = ? AND reminder_type = ? AND DATE(sent_at) = DATE('now')
            `).get(card.id, reminderKey);

            if (!alreadySent && card.metadata) {
                try {
                    const metadata = JSON.parse(card.metadata);
                    if (metadata.recipientEmail) {
                        await emailService.sendExpiryReminder({
                            to: metadata.recipientEmail,
                            card,
                            daysLeft
                        });

                        // Log that reminder was sent
                        db.prepare(`
                            INSERT INTO reminder_log (card_id, reminder_type, sent_at)
                            VALUES (?, ?, datetime('now'))
                        `).run(card.id, reminderKey);

                        console.log(`Expiry reminder sent for card ${card.code_prefix} (${daysLeft} days left)`);
                    }
                } catch (e) {
                    console.error(`Failed to process reminder for card ${card.id}:`, e);
                }
            }
        }
    } catch (error) {
        console.error('Error checking expiring cards:', error);
    }
}

/**
 * Get upcoming expirations for admin dashboard
 */
function getUpcomingExpirations(days = 30) {
    const db = getDatabase();
    const futureDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    return db.prepare(`
        SELECT id, code_prefix, tier, current_balance, expires_at,
               CAST((julianday(expires_at) - julianday('now')) AS INTEGER) as days_left
        FROM gift_cards 
        WHERE status = 'active' 
        AND current_balance > 0
        AND expires_at IS NOT NULL
        AND expires_at <= ?
        ORDER BY expires_at ASC
        LIMIT 20
    `).all(futureDate.toISOString());
}

/**
 * Auto-expire tasks past their end date
 */
function autoExpireTasks() {
    try {
        const db = getDatabase();
        const result = db.prepare(`
            UPDATE tasks SET status = 'expired', updated_at = datetime('now')
            WHERE status = 'active' AND end_date IS NOT NULL AND end_date < datetime('now')
        `).run();
        console.log(`Auto-expired ${result.changes} tasks`);

        // Also expire in-progress submissions for expired tasks
        db.prepare(`
            UPDATE task_submissions SET status = 'expired', updated_at = datetime('now')
            WHERE status = 'in_progress' AND task_id IN (SELECT id FROM tasks WHERE status = 'expired')
        `).run();
    } catch (e) { console.error('Auto-expire error:', e); }
}

/**
 * Generate daily challenges from active tasks
 */
function generateDailyChallenges() {
    try {
        const db = getDatabase();
        const today = new Date().toISOString().split('T')[0];

        // Check if already generated
        const existing = db.prepare(
            "SELECT COUNT(*) as count FROM daily_challenges WHERE challenge_date = ? AND challenge_type = 'daily'"
        ).get(today).count;

        if (existing > 0) return;

        // Pick 3 random active tasks for today's daily challenges
        const tasks = db.prepare(`
            SELECT id FROM tasks WHERE status = 'active' AND type NOT IN ('daily', 'weekly')
            ORDER BY RANDOM() LIMIT 3
        `).all();

        for (const task of tasks) {
            db.prepare(`
                INSERT INTO daily_challenges (task_id, challenge_date, challenge_type, bonus_points)
                VALUES (?, ?, 'daily', 50)
            `).run(task.id, today);
        }

        console.log(`Generated ${tasks.length} daily challenges for ${today}`);
    } catch (e) { console.error('Daily challenge gen error:', e); }
}

/**
 * Generate weekly challenges
 */
function generateWeeklyChallenges() {
    try {
        const db = getDatabase();
        const today = new Date().toISOString().split('T')[0];

        const existing = db.prepare(
            "SELECT COUNT(*) as count FROM daily_challenges WHERE challenge_date = ? AND challenge_type = 'weekly'"
        ).get(today).count;

        if (existing > 0) return;

        const tasks = db.prepare(`
            SELECT id FROM tasks WHERE status = 'active' AND difficulty IN ('medium', 'hard', 'legendary')
            ORDER BY RANDOM() LIMIT 2
        `).all();

        for (const task of tasks) {
            db.prepare(`
                INSERT INTO daily_challenges (task_id, challenge_date, challenge_type, bonus_points)
                VALUES (?, ?, 'weekly', 200)
            `).run(task.id, today);
        }

        console.log(`Generated ${tasks.length} weekly challenges`);
    } catch (e) { console.error('Weekly challenge gen error:', e); }
}

module.exports = {
    initScheduler,
    checkExpiringCards,
    getUpcomingExpirations,
    autoExpireTasks,
    generateDailyChallenges,
    generateWeeklyChallenges
};
