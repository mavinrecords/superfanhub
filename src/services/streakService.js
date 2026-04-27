/**
 * Streak Service - Mavin Community Task Master
 * Track daily/weekly streaks and award bonus multipliers
 */

const { getDatabase, runTransaction } = require('../db/database');
const { eventBus } = require('./eventBusService');

const STREAK_BONUSES = {
    3: { multiplier: 1.1, label: '3-Day Fire' },
    7: { multiplier: 1.25, label: 'Week Warrior' },
    14: { multiplier: 1.5, label: 'Unstoppable' },
    30: { multiplier: 2.0, label: 'Legendary' },
    60: { multiplier: 2.5, label: 'Diamond Streak' },
    100: { multiplier: 3.0, label: 'Century Legend' }
};

/**
 * Record daily activity and update streak
 */
function recordDailyActivity(userId) {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    let streak = db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(userId);

    if (!streak) {
        db.prepare(`
            INSERT INTO streaks (user_id, current_streak, longest_streak, last_activity_date, bonus_multiplier)
            VALUES (?, 1, 1, ?, 1.0)
        `).run(userId, today);
        return getStreakInfo(userId);
    }

    // Already recorded today
    if (streak.last_activity_date === today) {
        return getStreakInfo(userId);
    }

    const lastDate = new Date(streak.last_activity_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

    let newStreak;
    if (diffDays === 1) {
        // Consecutive day - increase streak
        newStreak = streak.current_streak + 1;
    } else if (diffDays > 1) {
        // Streak broken
        newStreak = 1;
    } else {
        newStreak = streak.current_streak;
    }

    const newLongest = Math.max(newStreak, streak.longest_streak);
    const newMultiplier = calculateStreakMultiplier(newStreak);

    db.prepare(`
        UPDATE streaks 
        SET current_streak = ?, longest_streak = ?, last_activity_date = ?,
            bonus_multiplier = ?, updated_at = datetime('now')
        WHERE user_id = ?
    `).run(newStreak, newLongest, today, newMultiplier, userId);

    eventBus.emitStreakUpdated(userId, { streak: newStreak, multiplier: newMultiplier });

    return getStreakInfo(userId);
}

/**
 * Get streak info for display
 */
function getStreakInfo(userId) {
    const db = getDatabase();
    const streak = db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(userId);

    if (!streak) {
        return {
            currentStreak: 0,
            longestStreak: 0,
            multiplier: 1.0,
            nextMilestone: 3,
            nextMilestoneLabel: STREAK_BONUSES[3].label
        };
    }

    const nextMilestone = getNextMilestone(streak.current_streak);

    return {
        currentStreak: streak.current_streak,
        longestStreak: streak.longest_streak,
        multiplier: streak.bonus_multiplier,
        lastActivity: streak.last_activity_date,
        nextMilestone: nextMilestone?.days || null,
        nextMilestoneLabel: nextMilestone?.label || 'Max Streak!',
        nextMilestoneMultiplier: nextMilestone?.multiplier || streak.bonus_multiplier
    };
}

/**
 * Reset broken streaks (run daily by scheduler)
 */
function resetBrokenStreaks() {
    const db = getDatabase();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = yesterday.toISOString().split('T')[0];

    const result = db.prepare(`
        UPDATE streaks SET current_streak = 0, bonus_multiplier = 1.0, updated_at = datetime('now')
        WHERE last_activity_date < ? AND current_streak > 0
    `).run(cutoff);

    return { brokenStreaks: result.changes };
}

// ─── HELPERS ────────────────────────────────────────────────

function calculateStreakMultiplier(streakDays) {
    let multiplier = 1.0;
    for (const [days, bonus] of Object.entries(STREAK_BONUSES)) {
        if (streakDays >= parseInt(days)) {
            multiplier = bonus.multiplier;
        }
    }
    return multiplier;
}

function getNextMilestone(currentStreak) {
    for (const [days, bonus] of Object.entries(STREAK_BONUSES)) {
        if (currentStreak < parseInt(days)) {
            return { days: parseInt(days), ...bonus };
        }
    }
    return null;
}

/**
 * Reset a single user's streak (admin op). Sets current_streak=0 and
 * bonus_multiplier=1.0; longest_streak is preserved as the historical record.
 * No-op if user has no streak row. Returns the post-reset streak info.
 */
function resetUserStreak(userId) {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM streaks WHERE user_id = ?').get(userId);
    if (!existing) {
        return { reset: false, reason: 'no_streak', userId };
    }
    db.prepare(`
        UPDATE streaks
        SET current_streak = 0, bonus_multiplier = 1.0, updated_at = datetime('now')
        WHERE user_id = ?
    `).run(userId);
    eventBus.emitStreakUpdated(userId, { streak: 0, multiplier: 1.0 });
    return {
        reset: true,
        userId,
        previousStreak: existing.current_streak,
        previousMultiplier: existing.bonus_multiplier,
        longestStreak: existing.longest_streak
    };
}

/**
 * List streaks across all users (admin). Joins users for display info.
 * Default sort: longest current streak first.
 */
function listStreaks({ limit = 50, offset = 0, sortBy = 'current' } = {}) {
    const db = getDatabase();
    const orderClause = sortBy === 'longest'
        ? 'ORDER BY s.longest_streak DESC, s.current_streak DESC'
        : 'ORDER BY s.current_streak DESC, s.longest_streak DESC';
    return db.prepare(`
        SELECT s.user_id, s.current_streak, s.longest_streak, s.last_activity_date,
               s.bonus_multiplier, s.updated_at,
               u.name as user_name, u.email as user_email
        FROM streaks s
        JOIN users u ON u.id = s.user_id
        ${orderClause}
        LIMIT ? OFFSET ?
    `).all(limit, offset);
}

module.exports = {
    recordDailyActivity,
    getStreakInfo,
    resetBrokenStreaks,
    resetUserStreak,
    listStreaks,
    STREAK_BONUSES
};
