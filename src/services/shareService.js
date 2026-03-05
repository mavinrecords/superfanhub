/**
 * Share Service
 * Handles secure sharing of gift cards
 */

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const emailService = require('./emailService');

// Share token expiry: 7 days
const SHARE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a secure share link
 * @param {number} cardId - Card ID
 * @param {string} senderName - Name of sender
 * @param {string} recipientName - Name of recipient (optional)
 * @param {string} message - Personal message (optional)
 * @returns {object} Share details including token and url
 */
function createShareLink(cardId, senderName, recipientName = '', message = '') {
    const db = getDatabase();

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SHARE_EXPIRY).toISOString();

    // Store token
    db.prepare(`
        INSERT INTO temp_tokens (
            token, type, data, expires_at
        ) VALUES (?, 'share', ?, ?)
    `).run(
        token,
        JSON.stringify({ cardId, senderName, recipientName, message }),
        expiresAt
    );

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return {
        token,
        url: `${baseUrl}?share=${token}`,
        expiresAt
    };
}

/**
 * Get share details by token
 */
function getShareDetails(token) {
    const db = getDatabase();

    const record = db.prepare(`
        SELECT * FROM temp_tokens 
        WHERE token = ? AND type = 'share' AND expires_at > datetime('now')
    `).get(token);

    if (!record) return null;

    return JSON.parse(record.data);
}

/**
 * Send share email
 */
async function sendShareEmail(email, shareDetails, card) {
    const { url, senderName, recipientName, message } = shareDetails;

    // Check limits
    // ... limit logic ...

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background: #0a0a0a; color: #fff; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .card { background: linear-gradient(135deg, #1a1a1a 0%, #111 100%); border-radius: 16px; padding: 30px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.1); }
            .title { font-size: 24px; font-weight: 700; color: #A2812E; margin-bottom: 20px; text-align: center; }
            .message { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; font-style: italic; color: #ddd; margin-bottom: 20px; }
            .balance { font-size: 36px; font-weight: 700; color: #10b981; text-align: center; margin: 20px 0; }
            .btn { display: block; width: 100%; padding: 16px; background: #10b981; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; text-align: center; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <div class="title">🎁 You've received a gift!</div>
                
                <p style="text-align: center;">
                    <strong>${senderName}</strong> sent you a gift card${recipientName ? `, ${recipientName}` : ''}!
                </p>
                
                ${message ? `<div class="message">"${message}"</div>` : ''}
                
                <div class="balance">$${card.currentBalance.toFixed(2)}</div>
                
                <a href="${url}" class="btn">Clean Gift Card</a>
                
                <p style="text-align: center; font-size: 12px; color: #666; margin-top: 20px;">
                    This link expires in 7 days.
                </p>
            </div>
        </div>
    </body>
    </html>
    `;

    return await emailService.sendEmail({
        to: email,
        subject: `${senderName} sent you a gift card!`,
        html
    });
}

module.exports = {
    createShareLink,
    getShareDetails,
    sendShareEmail
};
