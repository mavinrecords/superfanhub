/**
 * Email Service
 * Handles sending transaction receipts and notifications
 */

const nodemailer = require('nodemailer');

// Create transporter (configure in .env for production)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

/**
 * Send transaction receipt email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {object} params.transaction - Transaction details
 * @param {object} params.card - Card details
 */
async function sendTransactionReceipt({ to, transaction, card }) {
    if (!to || !process.env.SMTP_USER) {
        console.log('Email not sent: Missing recipient or SMTP configuration');
        return { sent: false, reason: 'Not configured' };
    }

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background: #0a0a0a; color: #fff; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: 700; color: #10b981; }
            .card { background: linear-gradient(135deg, #1a1a1a 0%, #111 100%); border-radius: 16px; padding: 30px; margin: 20px 0; border: 1px solid rgba(255,255,255,0.1); }
            .title { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #fff; }
            .amount { font-size: 36px; font-weight: 700; color: #10b981; margin: 20px 0; }
            .detail { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .detail:last-child { border-bottom: none; }
            .label { color: #888; font-size: 14px; }
            .value { color: #fff; font-weight: 500; font-size: 14px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
            .badge-success { background: rgba(16, 185, 129, 0.2); color: #10b981; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🎁 Gift Card Receipt</div>
            </div>
            
            <div class="card">
                <div class="title">Transaction Complete</div>
                <div class="amount">-$${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                
                <div class="detail">
                    <span class="label">Transaction ID</span>
                    <span class="value">#${transaction.id}</span>
                </div>
                <div class="detail">
                    <span class="label">Date</span>
                    <span class="value">${new Date(transaction.created_at).toLocaleString()}</span>
                </div>
                <div class="detail">
                    <span class="label">Card</span>
                    <span class="value">${card.code_prefix}-••••-••••-••••</span>
                </div>
                <div class="detail">
                    <span class="label">Remaining Balance</span>
                    <span class="value">$${card.current_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div class="detail">
                    <span class="label">Status</span>
                    <span class="badge badge-success">Completed</span>
                </div>
                ${transaction.notes ? `
                <div class="detail">
                    <span class="label">Notes</span>
                    <span class="value">${transaction.notes}</span>
                </div>
                ` : ''}
            </div>
            
            <div class="footer">
                <p>This is an automated receipt for your gift card transaction.</p>
                <p>If you did not make this transaction, please contact support immediately.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject: `Gift Card Receipt - $${transaction.amount.toFixed(2)} Redeemed`,
            html
        });
        console.log(`Transaction receipt sent to ${to}`);
        return { sent: true };
    } catch (error) {
        console.error('Failed to send receipt:', error);
        return { sent: false, error: error.message };
    }
}

/**
 * Send expiry reminder email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {object} params.card - Card details
 * @param {number} params.daysLeft - Days until expiry
 */
async function sendExpiryReminder({ to, card, daysLeft }) {
    if (!to || !process.env.SMTP_USER) {
        return { sent: false, reason: 'Not configured' };
    }

    const urgencyColor = daysLeft <= 1 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : '#10b981';
    const urgencyText = daysLeft <= 1 ? 'URGENT' : daysLeft <= 3 ? 'Soon' : 'Reminder';

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background: #0a0a0a; color: #fff; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .card { background: linear-gradient(135deg, #1a1a1a 0%, #111 100%); border-radius: 16px; padding: 30px; margin: 20px 0; border: 2px solid ${urgencyColor}; }
            .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 700; background: ${urgencyColor}; color: #fff; margin-bottom: 16px; }
            .title { font-size: 22px; font-weight: 600; margin-bottom: 10px; }
            .balance { font-size: 42px; font-weight: 700; color: #10b981; margin: 20px 0; }
            .expires { font-size: 16px; color: ${urgencyColor}; font-weight: 600; }
            .btn { display: inline-block; padding: 14px 32px; background: #10b981; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div style="font-size: 24px; font-weight: 700; color: #10b981;">🎁 Gift Card Expiring!</div>
            </div>
            
            <div class="card">
                <div class="badge">${urgencyText}: ${daysLeft} day${daysLeft === 1 ? '' : 's'} left</div>
                <div class="title">Your gift card is about to expire</div>
                <div class="balance">$${card.current_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="expires">Expires: ${new Date(card.expires_at).toLocaleDateString()}</div>
                <a href="${process.env.BASE_URL || 'http://localhost:3000'}" class="btn">Use Now →</a>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject: `⚠️ Your $${card.current_balance.toFixed(2)} Gift Card Expires in ${daysLeft} Day${daysLeft === 1 ? '' : 's'}!`,
            html
        });
        return { sent: true };
    } catch (error) {
        console.error('Failed to send expiry reminder:', error);
        return { sent: false, error: error.message };
    }
}

/**
 * Send generic email
 * @param {object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.html - HTML content
 */
async function sendEmail({ to, subject, html }) {
    if (!to || !process.env.SMTP_USER) {
        return { sent: false, reason: 'Not configured' };
    }

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject,
            html
        });
        return { sent: true };
    } catch (error) {
        console.error('Failed to send email:', error);
        return { sent: false, error: error.message };
    }
}

module.exports = {
    sendTransactionReceipt,
    sendExpiryReminder,
    sendEmail
};
