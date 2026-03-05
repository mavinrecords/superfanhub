/**
 * Proof Service - Mavin Community Task Master
 * Proof-of-completion verification layer
 */

const { getDatabase } = require('../db/database');

/**
 * Auto-verify proof based on type
 * Returns: { passed: boolean, reason: string }
 */
function autoVerifyProof(submission, task) {
    switch (task.required_proof) {
        case 'none':
            return { passed: true, reason: 'No proof required' };

        case 'url':
            return verifyUrl(submission.proof_url, task.target_url);

        case 'hashtag':
            return verifyHashtag(submission.proof_data, task.target_hashtag);

        case 'qr_scan':
            return verifyQRScan(submission.proof_data);

        case 'screenshot':
        case 'manual':
            // Requires manual moderation
            return { passed: null, reason: 'Requires manual review' };

        default:
            return { passed: null, reason: 'Unknown proof type' };
    }
}

/**
 * Verify URL proof (check if URL contains expected domain/path)
 */
function verifyUrl(proofUrl, targetUrl) {
    if (!proofUrl) return { passed: false, reason: 'No URL provided' };

    try {
        const proof = new URL(proofUrl);
        if (targetUrl) {
            const target = new URL(targetUrl);
            // Check if same domain
            if (proof.hostname === target.hostname) {
                return { passed: true, reason: 'URL domain verified' };
            }
            return { passed: false, reason: 'URL domain mismatch' };
        }
        // Just check it's a valid URL
        return { passed: true, reason: 'Valid URL provided' };
    } catch (e) {
        return { passed: false, reason: 'Invalid URL format' };
    }
}

/**
 * Verify hashtag proof (check if content contains required hashtag)
 */
function verifyHashtag(proofData, targetHashtag) {
    if (!proofData) return { passed: false, reason: 'No proof data provided' };
    if (!targetHashtag) return { passed: true, reason: 'No hashtag requirement' };

    const normalizedProof = proofData.toLowerCase();
    const normalizedTag = targetHashtag.toLowerCase().replace('#', '');

    if (normalizedProof.includes(`#${normalizedTag}`) || normalizedProof.includes(normalizedTag)) {
        return { passed: true, reason: 'Hashtag found in proof' };
    }

    return { passed: false, reason: `Hashtag #${normalizedTag} not found` };
}

/**
 * Verify QR scan data
 */
function verifyQRScan(proofData) {
    if (!proofData) return { passed: false, reason: 'No QR data' };

    // Check if QR data matches expected format (e.g., event check-in token)
    try {
        const data = JSON.parse(proofData);
        if (data.eventId && data.timestamp) {
            // Verify timestamp is recent (within 24 hours)
            const scanTime = new Date(data.timestamp);
            const now = new Date();
            const hoursDiff = (now - scanTime) / (1000 * 60 * 60);

            if (hoursDiff > 24) {
                return { passed: false, reason: 'QR scan expired (>24h old)' };
            }

            return { passed: true, reason: 'QR scan verified' };
        }
        return { passed: true, reason: 'QR data accepted' };
    } catch (e) {
        // Non-JSON QR data — accept as-is
        return { passed: true, reason: 'QR scan recorded' };
    }
}

/**
 * Process verification queue item
 */
function processVerification(verificationId, result, reviewedBy, notes = '') {
    const db = getDatabase();

    db.prepare(`
        UPDATE verification_queue 
        SET manual_result = ?, reviewed_by = ?, reviewed_at = datetime('now'), notes = ?
        WHERE id = ?
    `).run(result, reviewedBy, notes, verificationId);

    // Get submission info
    const item = db.prepare('SELECT * FROM verification_queue WHERE id = ?').get(verificationId);
    if (!item) return null;

    // Update submission status
    if (result === 'approved') {
        db.prepare(`
            UPDATE task_submissions SET status = 'verified', verified_by = ?,
                verified_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
        `).run(reviewedBy, item.submission_id);
    } else {
        db.prepare(`
            UPDATE task_submissions SET status = 'rejected', rejection_reason = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(notes || 'Proof rejected by moderator', item.submission_id);
    }

    return item;
}

/**
 * Get pending verifications (admin)
 */
function getPendingVerifications(limit = 50) {
    const db = getDatabase();
    return db.prepare(`
        SELECT vq.*, u.name as user_name, u.email, t.title as task_title, t.type as task_type
        FROM verification_queue vq
        JOIN users u ON vq.user_id = u.id
        JOIN tasks t ON vq.task_id = t.id
        WHERE vq.manual_result IS NULL
        ORDER BY vq.created_at ASC LIMIT ?
    `).all(limit);
}

module.exports = {
    autoVerifyProof,
    processVerification,
    getPendingVerifications,
    verifyUrl,
    verifyHashtag,
    verifyQRScan
};
