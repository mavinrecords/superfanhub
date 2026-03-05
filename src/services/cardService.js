const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDatabase, runTransaction } = require('../db/database');

const SALT_ROUNDS = 12;
const CODE_LENGTH = 16;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars (0, O, 1, I)

/**
 * Generate a cryptographically secure gift card code
 * Format: XXXX-XXXX-XXXX-XXXX
 */
function generateSecureCode() {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';

    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
        if ((i + 1) % 4 === 0 && i < CODE_LENGTH - 1) {
            code += '-';
        }
    }

    return code;
}

/**
 * Get code prefix for efficient lookup (first 4 chars)
 */
function getCodePrefix(code) {
    return code.replace(/-/g, '').substring(0, 4);
}

/**
 * Issue a new gift card
 */
async function issueCard({
    tier = 'standard',
    cardType = 'value',
    initialValue = 0,
    discountPercent = 0,
    discountUsesRemaining = null,
    expiresAt = null,
    issuedBy,
    metadata = null,
    ipAddress = null
}) {
    const code = generateSecureCode();
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);
    const codePrefix = getCodePrefix(code);
    const issuedAt = new Date().toISOString();

    const db = getDatabase();

    const result = runTransaction(() => {
        // Insert the gift card
        const insertCard = db.prepare(`
      INSERT INTO gift_cards (
        code_hash, code_prefix, tier, card_type, 
        initial_value, current_balance, discount_percent,
        discount_uses_remaining, status, issued_by, issued_at, 
        expires_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `);

        const cardResult = insertCard.run(
            codeHash,
            codePrefix,
            tier,
            cardType,
            initialValue,
            initialValue, // current_balance = initial_value at issuance
            discountPercent,
            discountUsesRemaining,
            issuedBy,
            issuedAt,
            expiresAt,
            metadata ? JSON.stringify(metadata) : null
        );

        const cardId = cardResult.lastInsertRowid;

        // Log the issuance transaction
        db.prepare(`
      INSERT INTO transactions (
        card_id, type, amount, balance_before, balance_after,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'issue', ?, 0, ?, ?, ?, ?, ?)
    `).run(
            cardId,
            initialValue,
            initialValue,
            issuedBy,
            issuedAt,
            ipAddress,
            `Issued ${tier} ${cardType} card`
        );

        return { cardId, code, codePrefix };
    });

    return {
        id: result.cardId,
        code: result.code, // Only returned once at issuance!
        codePrefix: result.codePrefix,
        tier,
        cardType,
        initialValue,
        discountPercent,
        discountUsesRemaining,
        status: 'active',
        issuedAt,
        expiresAt
    };
}

/**
 * Validate a gift card code and return card details (without sensitive data)
 */
async function validateCard(code, ipAddress = null) {
    const db = getDatabase();
    const codePrefix = getCodePrefix(code);
    const normalizedCode = code.replace(/-/g, '').toUpperCase();

    // Find cards with matching prefix
    const candidates = db.prepare(`
    SELECT * FROM gift_cards WHERE code_prefix = ?
  `).all(codePrefix);

    // Verify against each candidate (timing-safe comparison via bcrypt)
    for (const card of candidates) {
        const isMatch = await bcrypt.compare(code.toUpperCase(), card.code_hash);
        if (isMatch) {
            // Log successful validation
            db.prepare(`
        INSERT INTO validation_attempts (ip_address, code_prefix, success)
        VALUES (?, ?, 1)
      `).run(ipAddress, codePrefix);

            // Check expiry
            if (card.expires_at && new Date(card.expires_at) < new Date()) {
                return {
                    valid: false,
                    error: 'Card has expired',
                    card: null
                };
            }

            // Check status
            if (card.status !== 'active') {
                return {
                    valid: false,
                    error: `Card is ${card.status}`,
                    card: null
                };
            }

            return {
                valid: true,
                error: null,
                card: {
                    id: card.id,
                    codePrefix: card.code_prefix,
                    tier: card.tier,
                    cardType: card.card_type,
                    currentBalance: card.current_balance,
                    discountPercent: card.discount_percent,
                    discountUsesRemaining: card.discount_uses_remaining,
                    status: card.status,
                    expiresAt: card.expires_at
                }
            };
        }
    }

    // Log failed validation
    db.prepare(`
    INSERT INTO validation_attempts (ip_address, code_prefix, success)
    VALUES (?, ?, 0)
  `).run(ipAddress, codePrefix);

    return {
        valid: false,
        error: 'Invalid card code',
        card: null
    };
}

/**
 * Redeem value from a gift card (atomic operation)
 */
async function redeemValue(code, amount, performedBy, ipAddress = null, notes = null) {
    const validation = await validateCard(code, ipAddress);

    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const card = validation.card;

    if (card.cardType === 'discount') {
        return { success: false, error: 'This is a discount-only card with no stored value' };
    }

    if (amount <= 0) {
        return { success: false, error: 'Amount must be positive' };
    }

    if (amount > card.currentBalance) {
        return {
            success: false,
            error: `Insufficient balance. Available: $${card.currentBalance.toFixed(2)}`
        };
    }

    const db = getDatabase();
    const performedAt = new Date().toISOString();
    const newBalance = card.currentBalance - amount;

    const result = runTransaction(() => {
        // Update card balance
        const updateStmt = db.prepare(`
      UPDATE gift_cards 
      SET current_balance = ?, 
          status = CASE WHEN ? <= 0 AND discount_percent = 0 THEN 'exhausted' ELSE status END,
          updated_at = ?
      WHERE id = ?
    `);
        updateStmt.run(newBalance, newBalance, performedAt, card.id);

        // Log transaction
        db.prepare(`
      INSERT INTO transactions (
        card_id, type, amount, balance_before, balance_after,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'redeem', ?, ?, ?, ?, ?, ?, ?)
    `).run(
            card.id,
            amount,
            card.currentBalance,
            newBalance,
            performedBy,
            performedAt,
            ipAddress,
            notes || `Redeemed $${amount.toFixed(2)}`
        );

        return { newBalance };
    });

    return {
        success: true,
        amountRedeemed: amount,
        previousBalance: card.currentBalance,
        newBalance: result.newBalance,
        cardId: card.id
    };
}

/**
 * Apply discount to a ticket purchase
 */
async function applyDiscount(code, ticketAmount, ticketId, performedBy, ipAddress = null) {
    const validation = await validateCard(code, ipAddress);

    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const card = validation.card;

    if (card.cardType === 'value') {
        return { success: false, error: 'This is a value-only card with no discount' };
    }

    if (card.discountPercent <= 0) {
        return { success: false, error: 'No discount available on this card' };
    }

    if (card.discountUsesRemaining !== null && card.discountUsesRemaining <= 0) {
        return { success: false, error: 'Discount uses exhausted' };
    }

    if (ticketAmount <= 0) {
        return { success: false, error: 'Ticket amount must be positive' };
    }

    const db = getDatabase();
    const performedAt = new Date().toISOString();
    const discountAmount = (ticketAmount * card.discountPercent) / 100;
    const newUsesRemaining = card.discountUsesRemaining !== null
        ? card.discountUsesRemaining - 1
        : null;

    const result = runTransaction(() => {
        // Update discount uses if tracked
        const updateStmt = db.prepare(`
      UPDATE gift_cards 
      SET discount_uses_remaining = ?,
          status = CASE 
            WHEN ? = 0 AND current_balance <= 0 THEN 'exhausted' 
            ELSE status 
          END,
          updated_at = ?
      WHERE id = ?
    `);
        updateStmt.run(newUsesRemaining, newUsesRemaining, performedAt, card.id);

        // Log transaction
        db.prepare(`
      INSERT INTO transactions (
        card_id, type, discount_applied, ticket_id, ticket_amount,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'discount_apply', ?, ?, ?, ?, ?, ?, ?)
    `).run(
            card.id,
            discountAmount,
            ticketId,
            ticketAmount,
            performedBy,
            performedAt,
            ipAddress,
            `Applied ${card.discountPercent}% discount to ticket ${ticketId}`
        );

        return { discountAmount, newUsesRemaining };
    });

    return {
        success: true,
        ticketId,
        originalAmount: ticketAmount,
        discountPercent: card.discountPercent,
        discountAmount: result.discountAmount,
        finalAmount: ticketAmount - result.discountAmount,
        usesRemaining: result.newUsesRemaining,
        cardId: card.id
    };
}

/**
 * Freeze a card (admin only)
 */
function freezeCard(cardId, performedBy, ipAddress = null, notes = null) {
    const db = getDatabase();
    const performedAt = new Date().toISOString();

    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
    if (!card) {
        return { success: false, error: 'Card not found' };
    }

    if (card.status === 'frozen') {
        return { success: false, error: 'Card is already frozen' };
    }

    if (card.status === 'revoked') {
        return { success: false, error: 'Cannot freeze a revoked card' };
    }

    runTransaction(() => {
        db.prepare(`
      UPDATE gift_cards SET status = 'frozen', updated_at = ? WHERE id = ?
    `).run(performedAt, cardId);

        db.prepare(`
      INSERT INTO transactions (
        card_id, type, balance_before, balance_after,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'freeze', ?, ?, ?, ?, ?, ?)
    `).run(
            cardId,
            card.current_balance,
            card.current_balance,
            performedBy,
            performedAt,
            ipAddress,
            notes || 'Card frozen by admin'
        );
    });

    return { success: true, cardId, status: 'frozen' };
}

/**
 * Unfreeze a card (admin only)
 */
function unfreezeCard(cardId, performedBy, ipAddress = null, notes = null) {
    const db = getDatabase();
    const performedAt = new Date().toISOString();

    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
    if (!card) {
        return { success: false, error: 'Card not found' };
    }

    if (card.status !== 'frozen') {
        return { success: false, error: 'Card is not frozen' };
    }

    runTransaction(() => {
        db.prepare(`
      UPDATE gift_cards SET status = 'active', updated_at = ? WHERE id = ?
    `).run(performedAt, cardId);

        db.prepare(`
      INSERT INTO transactions (
        card_id, type, balance_before, balance_after,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'unfreeze', ?, ?, ?, ?, ?, ?)
    `).run(
            cardId,
            card.current_balance,
            card.current_balance,
            performedBy,
            performedAt,
            ipAddress,
            notes || 'Card unfrozen by admin'
        );
    });

    return { success: true, cardId, status: 'active' };
}

/**
 * Revoke a card permanently (admin only)
 */
function revokeCard(cardId, performedBy, ipAddress = null, notes = null) {
    const db = getDatabase();
    const performedAt = new Date().toISOString();

    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
    if (!card) {
        return { success: false, error: 'Card not found' };
    }

    if (card.status === 'revoked') {
        return { success: false, error: 'Card is already revoked' };
    }

    runTransaction(() => {
        db.prepare(`
      UPDATE gift_cards SET status = 'revoked', current_balance = 0, updated_at = ? WHERE id = ?
    `).run(performedAt, cardId);

        db.prepare(`
      INSERT INTO transactions (
        card_id, type, balance_before, balance_after,
        performed_by, performed_at, ip_address, notes
      ) VALUES (?, 'revoke', ?, 0, ?, ?, ?, ?)
    `).run(
            cardId,
            card.current_balance,
            performedBy,
            performedAt,
            ipAddress,
            notes || 'Card revoked by admin'
        );
    });

    return { success: true, cardId, status: 'revoked', forfeitedBalance: card.current_balance };
}

/**
 * Get all cards with optional filters
 */
function getCards({ status, tier, cardType, limit = 100, offset = 0 }) {
    const db = getDatabase();
    let query = 'SELECT * FROM gift_cards WHERE 1=1';
    const params = [];

    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }
    if (tier) {
        query += ' AND tier = ?';
        params.push(tier);
    }
    if (cardType) {
        query += ' AND card_type = ?';
        params.push(cardType);
    }

    query += ' ORDER BY issued_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const cards = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM gift_cards').get().count;

    return { cards, total, limit, offset };
}

/**
 * Get card by ID
 */
function getCardById(cardId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(cardId);
}

/**
 * Get transactions with optional filters
 */
function getTransactions({ cardId, type, limit = 100, offset = 0 }) {
    const db = getDatabase();
    let query = `
    SELECT t.*, g.code_prefix, g.tier, g.card_type 
    FROM transactions t
    JOIN gift_cards g ON t.card_id = g.id
    WHERE 1=1
  `;
    const params = [];

    if (cardId) {
        query += ' AND t.card_id = ?';
        params.push(cardId);
    }
    if (type) {
        query += ' AND t.type = ?';
        params.push(type);
    }

    query += ' ORDER BY t.performed_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transactions = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;

    return { transactions, total, limit, offset };
}

/**
 * Get dashboard statistics
 */
function getStats() {
    const db = getDatabase();

    const totalCards = db.prepare('SELECT COUNT(*) as count FROM gift_cards').get().count;
    const activeCards = db.prepare("SELECT COUNT(*) as count FROM gift_cards WHERE status = 'active'").get().count;
    const totalValue = db.prepare('SELECT SUM(current_balance) as total FROM gift_cards').get().total || 0;
    const totalRedemptions = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE type = 'redeem'").get().count;
    const totalDiscountApplied = db.prepare("SELECT SUM(discount_applied) as total FROM transactions WHERE type = 'discount_apply'").get().total || 0;

    const cardsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM gift_cards GROUP BY status
  `).all();

    const cardsByType = db.prepare(`
    SELECT card_type, COUNT(*) as count FROM gift_cards GROUP BY card_type
  `).all();

    const recentTransactions = db.prepare(`
    SELECT t.*, g.code_prefix 
    FROM transactions t
    JOIN gift_cards g ON t.card_id = g.id
    ORDER BY t.performed_at DESC LIMIT 10
  `).all();

    return {
        totalCards,
        activeCards,
        totalValue,
        totalRedemptions,
        totalDiscountApplied,
        cardsByStatus,
        cardsByType,
        recentTransactions
    };
}

/**
 * Get redemption history for a card (fan-facing)
 */
function getCardHistory(cardId) {
    const db = getDatabase();
    const transactions = db.prepare(`
        SELECT id, type, amount, discount_applied, ticket_id, ticket_amount, 
               performed_at, notes
        FROM transactions 
        WHERE card_id = ? AND type IN ('redeem', 'discount_apply')
        ORDER BY performed_at DESC
        LIMIT 50
    `).all(cardId);

    return transactions;
}

/**
 * Link a gift card to a user account
 */
function linkCardToUser(userId, code) {
    const db = getDatabase();

    // Validate card first
    // Note: We don't use the full validate function here because we need to handle "already linked" specifically
    // but validateCard doesn't check user linkage yet. 
    // For now, let's just get the card by code prefix and verify hash

    const codePrefix = getCodePrefix(code);
    const existingCards = db.prepare('SELECT * FROM gift_cards WHERE code_prefix = ?').all(codePrefix);

    let targetCard = null;

    for (const card of existingCards) {
        if (bcrypt.compareSync(code.toUpperCase(), card.code_hash)) {
            targetCard = card;
            break;
        }
    }

    if (!targetCard) {
        return { success: false, error: 'Invalid card code' };
    }

    if (targetCard.user_id) {
        if (targetCard.user_id === userId) {
            return { success: false, error: 'Card is already linked to your account' };
        }
        return { success: false, error: 'Card is already linked to another account' };
    }

    if (targetCard.status === 'revoked' || targetCard.status === 'exhausted') {
        return { success: false, error: `Cannot link a ${targetCard.status} card` };
    }

    // Link the card
    const now = new Date().toISOString();

    runTransaction(() => {
        db.prepare('UPDATE gift_cards SET user_id = ?, updated_at = ? WHERE id = ?')
            .run(userId, now, targetCard.id);

        db.prepare(`
            INSERT INTO transactions (
                card_id, type, amount, balance_before, balance_after,
                performed_by, performed_at, notes
            ) VALUES (?, 'link', 0, ?, ?, ?, ?, 'Linked to user account')
        `).run(
            targetCard.id,
            targetCard.current_balance,
            targetCard.current_balance,
            `User:${userId}`,
            now
        );
    });

    return { success: true, cardId: targetCard.id };
}

/**
 * Get all gift cards owned by a user
 */
function getUserCards(userId) {
    const db = getDatabase();

    const cards = db.prepare(`
        SELECT id, code_prefix, tier, card_type, current_balance, 
               discount_percent, status, expires_at, created_at, user_id
        FROM gift_cards 
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId);

    return cards;
}

module.exports = {
    generateSecureCode,
    issueCard,
    validateCard,
    redeemValue,
    applyDiscount,
    freezeCard,
    unfreezeCard,
    revokeCard,
    getCards,
    getCardById,
    getCardHistory,
    getTransactions,
    getStats,
    linkCardToUser,
    getUserCards
};
