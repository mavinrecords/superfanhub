/**
 * Import/Export Service
 * Handles bulk card operations via CSV
 */

const { getDatabase } = require('../db/database');
const cardService = require('./cardService');

/**
 * Export cards to CSV format
 * @param {object} filters - Optional filters (status, tier, cardType)
 * @returns {string} CSV string
 */
function exportCardsToCSV(filters = {}) {
    const db = getDatabase();

    let query = 'SELECT * FROM gift_cards WHERE 1=1';
    const params = [];

    if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
    }
    if (filters.tier) {
        query += ' AND tier = ?';
        params.push(filters.tier);
    }
    if (filters.cardType) {
        query += ' AND card_type = ?';
        params.push(filters.cardType);
    }

    query += ' ORDER BY id DESC';

    const cards = db.prepare(query).all(...params);

    // CSV headers
    const headers = [
        'ID', 'Code Prefix', 'Tier', 'Type', 'Initial Value', 'Current Balance',
        'Discount %', 'Discount Uses', 'Status', 'Issued By', 'Issued At', 'Expires At'
    ];

    const rows = cards.map(card => [
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
    ]);

    // Build CSV
    const csvLines = [headers.join(',')];
    rows.forEach(row => {
        csvLines.push(row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
    });

    return csvLines.join('\n');
}

/**
 * Export transactions to CSV format
 * @param {object} filters - Optional filters
 * @returns {string} CSV string
 */
function exportTransactionsToCSV(filters = {}) {
    const db = getDatabase();

    let query = `
        SELECT t.*, g.code_prefix 
        FROM transactions t 
        LEFT JOIN gift_cards g ON t.card_id = g.id 
        WHERE 1=1
    `;
    const params = [];

    if (filters.type) {
        query += ' AND t.type = ?';
        params.push(filters.type);
    }
    if (filters.startDate) {
        query += ' AND t.performed_at >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND t.performed_at <= ?';
        params.push(filters.endDate);
    }

    query += ' ORDER BY t.performed_at DESC LIMIT 10000';

    const transactions = db.prepare(query).all(...params);

    const headers = [
        'ID', 'Card ID', 'Code Prefix', 'Type', 'Amount', 'Balance Before',
        'Balance After', 'Performed By', 'Performed At', 'Notes'
    ];

    const rows = transactions.map(tx => [
        tx.id,
        tx.card_id,
        tx.code_prefix,
        tx.type,
        tx.amount ?? '',
        tx.balance_before ?? '',
        tx.balance_after ?? '',
        tx.performed_by,
        tx.performed_at,
        tx.notes || ''
    ]);

    const csvLines = [headers.join(',')];
    rows.forEach(row => {
        csvLines.push(row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
    });

    return csvLines.join('\n');
}

/**
 * Parse CSV and create cards in bulk
 * @param {string} csvContent - CSV content
 * @param {string} issuedBy - Admin username
 * @returns {object} Result with success count and errors
 */
async function importCardsFromCSV(csvContent, issuedBy) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
        return { success: 0, errors: ['CSV must have header row and at least one data row'] };
    }

    // Parse header
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const requiredHeaders = ['tier', 'type'];

    for (const required of requiredHeaders) {
        if (!headers.includes(required)) {
            return { success: 0, errors: [`Missing required column: ${required}`] };
        }
    }

    const results = { success: 0, errors: [], cards: [] };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = values[idx] || '';
            });

            // Map CSV columns to card data
            const cardData = {
                tier: row.tier || 'standard',
                cardType: row.type || row.cardtype || 'value',
                initialValue: parseFloat(row.value || row.initialvalue || row['initial value']) || 0,
                discountPercent: parseFloat(row.discount || row.discountpercent || row['discount %']) || 0,
                discountUses: row.uses === 'unlimited' ? null : parseInt(row.uses || row.discountuses) || null,
                expiresAt: row.expires || row.expiresat || row['expires at'] || null,
                recipientEmail: row.email || row.recipientemail || null,
                notes: row.notes || `Bulk import row ${i}`
            };

            // Issue card
            const result = await cardService.issueCard(cardData, issuedBy);
            if (result.id) {
                results.success++;
                results.cards.push({ row: i, id: result.id, code: result.code });
            }
        } catch (error) {
            results.errors.push(`Row ${i}: ${error.message}`);
        }
    }

    return results;
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());

    return result;
}

module.exports = {
    exportCardsToCSV,
    exportTransactionsToCSV,
    importCardsFromCSV
};
