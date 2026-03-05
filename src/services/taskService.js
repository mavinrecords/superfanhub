/**
 * Task Service - Mavin Community Task Master
 * Task engine: CRUD, assignment, progress tracking, completion evaluation
 */

const { getDatabase, runTransaction } = require('../db/database');
const { addPoints } = require('./loyaltyCardService');
const { eventBus } = require('./eventBusService');

// ─── ADMIN: Task CRUD ───────────────────────────────────────

function createTask({
    title, description, type, category, points, xp,
    maxCompletions, requiredProof, targetUrl, targetHashtag,
    artistId, artistName, startDate, endDate,
    isRecurring, recurrenceInterval, difficulty,
    imageUrl, squadOnly, createdBy
}) {
    const db = getDatabase();
    const stmt = db.prepare(`
        INSERT INTO tasks (
            title, description, type, category, points, xp,
            max_completions, required_proof, target_url, target_hashtag,
            artist_id, artist_name, start_date, end_date,
            is_recurring, recurrence_interval, status, difficulty,
            image_url, squad_only, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `);

    const result = stmt.run(
        title, description || '', type, category || 'general',
        points || 0, xp || 0, maxCompletions || 1,
        requiredProof || 'none', targetUrl || null, targetHashtag || null,
        artistId || null, artistName || null,
        startDate || null, endDate || null,
        isRecurring ? 1 : 0, recurrenceInterval || null,
        difficulty || 'easy', imageUrl || null,
        squadOnly ? 1 : 0, createdBy || 'admin'
    );

    return getTaskById(result.lastInsertRowid);
}

function updateTask(id, updates) {
    const db = getDatabase();
    const allowed = [
        'title', 'description', 'type', 'category', 'points', 'xp',
        'max_completions', 'required_proof', 'target_url', 'target_hashtag',
        'artist_id', 'artist_name', 'start_date', 'end_date',
        'is_recurring', 'recurrence_interval', 'status', 'difficulty',
        'image_url', 'squad_only'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return getTaskById(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return getTaskById(id);
}

function deleteTask(id) {
    const db = getDatabase();
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { success: true };
}

function getTaskById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function listTasks({ status, type, artistId, difficulty, limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (status) { query += ' AND status = ?'; params.push(status); }
    if (type) { query += ' AND type = ?'; params.push(type); }
    if (artistId) { query += ' AND artist_id = ?'; params.push(artistId); }
    if (difficulty) { query += ' AND difficulty = ?'; params.push(difficulty); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params);
}

// ─── USER: Task Progress & Completion ───────────────────────

function getUserTasks(userId, { status, type, limit = 50 } = {}) {
    const db = getDatabase();
    let query = `
        SELECT t.*, 
            ts.id as submission_id, ts.status as user_status,
            ts.progress, ts.progress_target,
            ts.points_awarded, ts.completed_at as user_completed_at
        FROM tasks t
        LEFT JOIN task_submissions ts ON t.id = ts.task_id AND ts.user_id = ?
        WHERE t.status = 'active'
    `;
    const params = [userId];

    if (type) { query += ' AND t.type = ?'; params.push(type); }

    // Filter expired tasks
    query += " AND (t.end_date IS NULL OR t.end_date >= datetime('now'))";

    query += ` ORDER BY 
        CASE WHEN ts.status = 'in_progress' THEN 0
             WHEN ts.status IS NULL THEN 1
             WHEN ts.status = 'submitted' THEN 2
             ELSE 3 END,
        t.points DESC
        LIMIT ?`;
    params.push(limit);

    return db.prepare(query).all(...params);
}

function startTask(userId, taskId) {
    const db = getDatabase();
    const task = getTaskById(taskId);
    if (!task) throw new Error('Task not found');
    if (task.status !== 'active') throw new Error('Task is not active');

    // Check if already started
    const existing = db.prepare(
        "SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ? AND status != 'rejected'"
    ).get(userId, taskId);

    if (existing) return existing;

    const stmt = db.prepare(`
        INSERT INTO task_submissions (user_id, task_id, status, progress, progress_target)
        VALUES (?, ?, 'in_progress', 0, ?)
    `);
    stmt.run(userId, taskId, task.max_completions || 1);

    // Ensure contribution score row exists
    ensureContributionScore(userId);

    return db.prepare(
        "SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ? AND status != 'rejected'"
    ).get(userId, taskId);
}

function submitTaskProof(userId, taskId, { proofType, proofData, proofUrl } = {}) {
    const db = getDatabase();
    const task = getTaskById(taskId);
    if (!task) throw new Error('Task not found');

    let submission = db.prepare(
        "SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ? AND status != 'rejected'"
    ).get(userId, taskId);

    // Auto-start if not started
    if (!submission) {
        startTask(userId, taskId);
        submission = db.prepare(
            "SELECT * FROM task_submissions WHERE user_id = ? AND task_id = ? AND status != 'rejected'"
        ).get(userId, taskId);
    }

    if (submission.status === 'verified') throw new Error('Task already completed');
    if (submission.status === 'submitted') throw new Error('Proof already submitted, awaiting verification');

    // Update submission with proof
    db.prepare(`
        UPDATE task_submissions 
        SET proof_type = ?, proof_data = ?, proof_url = ?,
            status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
    `).run(proofType || task.required_proof, proofData || null, proofUrl || null, submission.id);

    // Auto-verify if no proof required
    if (task.required_proof === 'none') {
        return completeTask(userId, taskId, 'auto');
    }

    // Add to verification queue for manual review
    db.prepare(`
        INSERT INTO verification_queue (submission_id, user_id, task_id, proof_type, proof_data)
        VALUES (?, ?, ?, ?, ?)
    `).run(submission.id, userId, taskId, proofType || task.required_proof, proofData || '');

    return { status: 'submitted', message: 'Proof submitted for verification' };
}

function completeTask(userId, taskId, verifiedBy = 'system') {
    const db = getDatabase();
    const task = getTaskById(taskId);
    if (!task) throw new Error('Task not found');

    return runTransaction(() => {
        // Get active multiplier
        const multiplier = getActiveMultiplier(task.type, task.artist_id);

        const basePoints = task.points;
        const totalPoints = Math.floor(basePoints * multiplier);

        // Update submission
        db.prepare(`
            UPDATE task_submissions 
            SET status = 'verified', points_awarded = ?, xp_awarded = ?,
                multiplier = ?, verified_by = ?, verified_at = datetime('now'),
                completed_at = datetime('now'), progress = progress_target,
                updated_at = datetime('now')
            WHERE user_id = ? AND task_id = ? AND status IN ('in_progress', 'submitted')
        `).run(totalPoints, task.xp || 0, multiplier, verifiedBy, userId, taskId);

        // Award points to loyalty card
        try {
            addPoints(userId, totalPoints, `Task: ${task.title}`, 'task');
        } catch (e) {
            // User may not have loyalty card yet - ok for contribution score
        }

        // Update contribution score
        updateContributionScore(userId, task.type, totalPoints);

        // Emit event
        eventBus.emitTaskCompleted(userId, { taskId, points: totalPoints, taskType: task.type });

        return {
            success: true,
            task: task.title,
            points: totalPoints,
            multiplier,
            xp: task.xp || 0
        };
    });
}

// ─── HELPERS ────────────────────────────────────────────────

function getActiveMultiplier(taskType, artistId) {
    const db = getDatabase();
    const now = new Date().toISOString();

    const multiplier = db.prepare(`
        SELECT MAX(multiplier) as max_mult FROM campaign_multipliers
        WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
        AND (applies_to = 'all' OR applies_to = ?)
        AND (artist_id IS NULL OR artist_id = ?)
    `).get(now, now, taskType, artistId || '');

    return multiplier?.max_mult || 1.0;
}

function ensureContributionScore(userId) {
    const db = getDatabase();
    const exists = db.prepare('SELECT user_id FROM contribution_scores WHERE user_id = ?').get(userId);
    if (!exists) {
        db.prepare("INSERT INTO contribution_scores (user_id) VALUES (?)").run(userId);
    }
}

function updateContributionScore(userId, taskType, points) {
    const db = getDatabase();
    ensureContributionScore(userId);

    const scoreField = {
        'stream': 'streaming_score',
        'social': 'social_score',
        'ugc': 'social_score',
        'referral': 'referral_score',
        'irl': 'event_score',
        'quiz': 'social_score',
        'daily': 'social_score',
        'weekly': 'social_score'
    }[taskType] || 'social_score';

    db.prepare(`
        UPDATE contribution_scores 
        SET total_score = total_score + ?,
            tasks_completed = tasks_completed + 1,
            ${scoreField} = ${scoreField} + ?,
            updated_at = datetime('now')
        WHERE user_id = ?
    `).run(points, points, userId);
}

function getTaskStats() {
    const db = getDatabase();
    return db.prepare(`
        SELECT 
            COUNT(*) as total_tasks,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tasks,
            (SELECT COUNT(*) FROM task_submissions WHERE status = 'verified') as total_completions,
            (SELECT COUNT(DISTINCT user_id) FROM task_submissions) as unique_participants,
            (SELECT SUM(points_awarded) FROM task_submissions WHERE status = 'verified') as total_points_awarded
        FROM tasks
    `).get();
}

module.exports = {
    createTask, updateTask, deleteTask, getTaskById, listTasks,
    getUserTasks, startTask, submitTaskProof, completeTask,
    getActiveMultiplier, getTaskStats, ensureContributionScore
};
