// Admin Dashboard JavaScript

let currentAdmin = null;
let issuedCards = [];

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const adminDashboard = document.getElementById('adminDashboard');

// Check session on load
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initSidebarToggle();
});

// Sidebar toggle
function initSidebarToggle() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    // Restore state from localStorage
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar?.classList.add('collapsed');
    }

    toggleBtn?.addEventListener('click', () => {
        sidebar?.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar?.classList.contains('collapsed'));
    });
}

async function checkSession() {
    try {
        const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
        const data = await response.json();

        if (data.authenticated) {
            currentAdmin = data.admin;
            showDashboard();
        }
    } catch (error) {
        console.error('Session check failed:', error);
    }
}

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner"></span>';
    loginError.classList.add('hidden');

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            loginError.textContent = data.error || 'Login failed';
            loginError.classList.remove('hidden');
            return;
        }

        currentAdmin = data.admin;
        showDashboard();

    } catch (error) {
        loginError.textContent = 'Network error. Please try again.';
        loginError.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Login';
    }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
        console.error('Logout error:', error);
    }

    currentAdmin = null;
    adminDashboard.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginScreen.style.display = 'flex';
});

// Expiration Preset Handlers
document.querySelectorAll('.expiry-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const months = parseInt(btn.dataset.months);
        const date = new Date();
        date.setMonth(date.getMonth() + months);
        document.getElementById('issueExpiry').valueAsDate = date;
    });
});

// Currency Input Formatting (live formatting with commas while typing)
const valueInput = document.getElementById('issueValue');
if (valueInput) {
    let lastValue = '';

    valueInput.addEventListener('input', function (e) {
        // Get cursor position
        const cursorPos = this.selectionStart;
        const oldLength = lastValue.length;

        // Remove non-numeric characters except decimal
        let value = this.value.replace(/[^\d.]/g, '');

        // Ensure only one decimal point
        const parts = value.split('.');
        if (parts.length > 2) {
            value = parts[0] + '.' + parts.slice(1).join('');
        }

        if (value) {
            const [integer, decimal] = value.split('.');
            let formatted = parseInt(integer || '0', 10).toLocaleString('en-US');
            formatted = decimal !== undefined ? `${formatted}.${decimal}` : formatted;

            this.value = formatted;
            lastValue = formatted;

            // Adjust cursor position
            const newLength = formatted.length;
            const diff = newLength - oldLength;
            this.setSelectionRange(cursorPos + diff, cursorPos + diff);
        } else {
            lastValue = '';
        }
    });

    // Store clean value for form submission
    valueInput.form?.addEventListener('submit', function () {
        valueInput.value = valueInput.value.replace(/,/g, '');
    });
}

// Success Modal
function showSuccessModal(title, message, duration = 2000) {
    const modal = document.getElementById('successModal');
    document.getElementById('successTitle').textContent = title;
    document.getElementById('successMessage').textContent = message;

    modal.classList.add('active');

    setTimeout(() => {
        modal.classList.remove('active');
    }, duration);
}

// Format expiration date for display (e.g., "15 March 2025")
function formatExpirationDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

// Show dashboard
function showDashboard() {
    loginScreen.classList.add('hidden');
    loginScreen.style.display = 'none';
    adminDashboard.classList.remove('hidden');

    document.getElementById('adminUsername').textContent = currentAdmin.username;
    document.getElementById('userAvatar').textContent = currentAdmin.username[0].toUpperCase();

    loadStats();
}

// Page navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const page = item.dataset.page;
        showPage(page);
    });
});

// Button event listeners (to avoid CSP inline handler violations)
document.getElementById('issueCardDashboardBtn')?.addEventListener('click', () => showPage('issue'));
document.getElementById('issueCardCardsBtn')?.addEventListener('click', () => showPage('issue'));
document.getElementById('applyFiltersBtn')?.addEventListener('click', () => loadCards());
document.getElementById('applyTxFiltersBtn')?.addEventListener('click', () => loadTransactions());
document.getElementById('copyCodeBtn')?.addEventListener('click', () => copyCode());
document.getElementById('downloadBulkCodesBtn')?.addEventListener('click', () => downloadBulkCodes());
document.getElementById('issueAnotherBtn')?.addEventListener('click', () => resetIssueForm());
document.getElementById('modalCloseBtn')?.addEventListener('click', () => closeModal());


function showPage(page) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById(`${page}Page`).classList.remove('hidden');

    // Load data
    // Load data
    if (page === 'dashboard') loadStats();
    if (page === 'cards') loadCards();
    if (page === 'transactions') loadTransactions();
    if (page === 'analytics') loadAnalytics();
    if (page === 'loyalty') loadLoyaltyStats();
    if (page === 'superfans') loadSuperFans();
    if (page === 'promos') { /* No load needed for form */ }
    if (page === 'campaigns') loadEngagementCampaigns();
}

// Load stats
async function loadStats() {
    // ... existing stats logic (could be improved to load Loyalty stats too)
}

// =============================================================
// CAMPAIGNS & PROMOS
// =============================================================
// =============================================================
// CAMPAIGNS & PROMOS
// =============================================================
document.getElementById('createPromoForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
        const payload = {
            name: document.getElementById('promoName').value,
            discountPercent: document.getElementById('promoDiscount').value,
            count: document.getElementById('promoCount').value,
            prefix: document.getElementById('promoPrefix').value,
            maxUses: document.getElementById('promoUses').value,
            expiresAt: document.getElementById('promoExpiry').value
        };

        const response = await fetch('/api/admin/campaigns', { // Keeping endpoint as is for Promos
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('promoResult').classList.remove('hidden');
            document.getElementById('promoResultCount').textContent = data.count;
            showSuccessModal('Promo Campaign Created', `Generated ${data.count} promo codes starting with ${data.prefix}`);
            e.target.reset();
        } else {
            alert(data.error || 'Failed to create campaign');
        }
    } catch (error) {
        console.error('Promo error:', error);
        alert('Network error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// Engagement Campaigns (New Module)
async function loadEngagementCampaigns() {
    const tbody = document.getElementById('engagementCampaignsTable');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Loading...</td></tr>';

    try {
        const response = await fetch('/api/campaigns/manage', { credentials: 'same-origin' });
        const campaigns = await response.json();

        if (!campaigns || campaigns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No campaigns found. Create one!</td></tr>';
            return;
        }

        tbody.innerHTML = campaigns.map(c => `
            <tr>
                <td><strong>${c.title}</strong></td>
                <td><span class="badge badge-info">${c.type}</span></td>
                <td>${c.points} pts</td>
                <td><span class="badge badge-${c.status === 'active' ? 'active' : 'frozen'}">${c.status}</span></td>
                <td>${formatDate(c.starts_at) || '-'}</td>
                <td>${formatDate(c.ends_at) || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="alert('Edit not implemented yet')">Edit</button>
                    ${c.status === 'active'
                ? `<button class="btn btn-sm btn-danger" onclick="toggleCampaignStatus('${c.id}', 'ended')">End</button>`
                : `<button class="btn btn-sm btn-success" onclick="toggleCampaignStatus('${c.id}', 'active')">Activate</button>`}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-error">Failed to load campaigns</td></tr>';
    }
}

document.getElementById('createEngagementForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    const payload = {
        title: document.getElementById('engTitle').value,
        type: document.getElementById('engType').value,
        description: document.getElementById('engDesc').value,
        points: parseInt(document.getElementById('engPoints').value),
        endsAt: document.getElementById('engEndDate').value || null,
        imageUrl: document.getElementById('engImage').value || null
    };

    try {
        const res = await fetch('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showSuccessModal('Campaign Created', 'Engagement campaign is now live');
            closeCampaignModal();
            loadEngagementCampaigns();
            e.target.reset();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to create campaign');
        }
    } catch (err) {
        console.error(err);
        alert('Error creating campaign');
    } finally {
        btn.disabled = false;
    }
});

function showCreateCampaignModal() {
    document.getElementById('campaignModal').classList.add('active');
}

function closeCampaignModal() {
    document.getElementById('campaignModal').classList.remove('active');
}


// =============================================================
// IMPORT / EXPORT
// =============================================================
document.getElementById('importCsvInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm(`Import cards from ${file.name}? This might take a moment.`)) {
        e.target.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('file', file); // Note: server expects text/csv body, but standard uploads use FormData. 
    // Wait, importService expects raw text body. Let's read file first.

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const csvContent = event.target.result;
            const response = await fetch('/api/admin/import/cards', {
                method: 'POST',
                headers: { 'Content-Type': 'text/csv' },
                body: csvContent // Send raw CSV content
            });

            const data = await response.json();

            if (response.ok) {
                showSuccessModal('Import Complete', `Imported ${data.processed} cards (${data.success} successful, ${data.errors} failed).`);
                loadCards(); // Refresh list
            } else {
                alert(data.error || 'Import failed');
            }
        } catch (error) {
            console.error('Import error:', error);
            alert('Failed to upload file');
        }
        e.target.value = ''; // Reset
    };
    reader.readAsText(file);
});

async function loadLoyaltyStats() {
    // Placeholder - fetch stats if specific endpoint exists, or reuse dashboard stats
    // Currently we don't have a dedicated /api/admin/loyalty/stats endpoint, 
    // but we can add one or just mock it for now.
    // Let's hide the "-"s
}

async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats', { credentials: 'same-origin' });
        const data = await response.json();

        // Main metrics
        document.getElementById('statTotalCards').textContent = data.totalCards.toLocaleString();
        document.getElementById('statActiveCards').textContent = data.activeCards.toLocaleString();
        document.getElementById('statTotalValue').textContent = `$${data.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('statRedemptions').textContent = data.totalRedemptions.toLocaleString();

        // Active percentage
        const activePercent = data.totalCards > 0 ? Math.round((data.activeCards / data.totalCards) * 100) : 0;
        document.getElementById('activePercentage').textContent = `${activePercent}%`;

        // Card type breakdown
        const typeBreakdown = { value: 0, discount: 0, hybrid: 0 };
        data.cardsByType?.forEach(item => {
            typeBreakdown[item.card_type] = item.count;
        });
        document.getElementById('typeValue').textContent = typeBreakdown.value || 0;
        document.getElementById('typeDiscount').textContent = typeBreakdown.discount || 0;
        document.getElementById('typeHybrid').textContent = typeBreakdown.hybrid || 0;

        // Status breakdown
        const statusBreakdown = { active: 0, frozen: 0, revoked: 0, exhausted: 0 };
        data.cardsByStatus?.forEach(item => {
            statusBreakdown[item.status] = item.count;
        });
        document.getElementById('statusActive').textContent = statusBreakdown.active || 0;
        document.getElementById('statusFrozen').textContent = statusBreakdown.frozen || 0;
        document.getElementById('statusRevoked').textContent = statusBreakdown.revoked || 0;
        document.getElementById('statusExhausted').textContent = statusBreakdown.exhausted || 0;

        // Trend indicator (show total as trend for now)
        document.getElementById('cardsTrendValue').textContent = `${data.totalCards} total`;

        // Recent transactions
        const tbody = document.getElementById('recentTransactions');
        tbody.innerHTML = data.recentTransactions.map(tx => `
      <tr>
        <td>${formatDate(tx.performed_at)}</td>
        <td class="font-mono">${tx.code_prefix}••••</td>
        <td><span class="badge badge-${tx.type === 'redeem' ? 'value' : tx.type === 'issue' ? 'active' : 'discount'}">${tx.type}</span></td>
        <td>${tx.amount ? `$${tx.amount.toFixed(2)}` : tx.discount_applied ? `$${tx.discount_applied.toFixed(2)}` : '-'}</td>
        <td>${tx.performed_by}</td>
      </tr>
    `).join('');

    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load cards
async function loadCards() {
    const status = document.getElementById('filterStatus').value;
    const tier = document.getElementById('filterTier').value;
    const cardType = document.getElementById('filterType').value;

    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (tier) params.append('tier', tier);
    if (cardType) params.append('cardType', cardType);

    try {
        const response = await fetch(`/api/admin/cards?${params}`, { credentials: 'same-origin' });
        const data = await response.json();

        // Debug: log first card to see data structure
        console.log('Cards API response:', data.cards?.[0]);

        const tbody = document.getElementById('cardsTableBody');

        // Empty state per UI Contract
        if (!data.cards || data.cards.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9">
                        <div class="empty-state">
                            <div class="empty-state__title">No gift cards yet</div>
                            <button class="btn btn-primary" onclick="showPage('issue')">Issue First Card</button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.cards.map(card => `
      <tr class="card-row" data-card-id="${card.id}" data-card-code="${card.code_prefix}-****-****-****" style="cursor:pointer;">
        <td>${card.id}</td>
        <td class="font-mono">${card.code_prefix}••••</td>
        <td><span class="badge badge-${card.tier}">${card.tier}</span></td>
        <td><span class="badge badge-${card.card_type}">${card.card_type}</span></td>
        <td>$${(card.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${card.discount_percent > 0 ? `${card.discount_percent}%` : '-'}</td>
        <td><span class="badge badge-${card.status}">${card.status}</span></td>
        <td>${formatDate(card.issued_at)}</td>
        <td>
          ${card.status === 'active' ? `
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();freezeCard(${card.id})">Freeze</button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();revokeCard(${card.id})">Revoke</button>
          ` : ''}
          ${card.status === 'frozen' ? `
            <button class="btn btn-sm btn-success" onclick="event.stopPropagation();unfreezeCard(${card.id})">Unfreeze</button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();revokeCard(${card.id})">Revoke</button>
          ` : ''}
        </td>
      </tr>
    `).join('');

        // Add click handlers for row details
        document.querySelectorAll('.card-row').forEach(row => {
            row.addEventListener('click', () => showCardDetails(row.dataset.cardId, row.dataset.cardCode));
        });

    } catch (error) {
        console.error('Failed to load cards:', error);
    }
}

// Load transactions
async function loadTransactions() {
    const type = document.getElementById('filterTxType').value;

    const params = new URLSearchParams();
    if (type) params.append('type', type);

    try {
        const response = await fetch(`/api/admin/transactions?${params}`, { credentials: 'same-origin' });
        const data = await response.json();

        const tbody = document.getElementById('transactionsTableBody');
        tbody.innerHTML = data.transactions.map(tx => {
            const balanceChange = (tx.balance_before !== null && tx.balance_after !== null)
                ? `$${tx.balance_before.toFixed(2)} → $${tx.balance_after.toFixed(2)}`
                : '-';
            return `
      <tr>
        <td>${formatDate(tx.performed_at)}</td>
        <td class="font-mono">${tx.code_prefix}••••</td>
        <td><span class="badge badge-${tx.type === 'redeem' ? 'value' : tx.type === 'issue' ? 'active' : 'discount'}">${tx.type}</span></td>
        <td>${tx.amount ? `$${tx.amount.toFixed(2)}` : tx.discount_applied ? `$${tx.discount_applied.toFixed(2)}` : '-'}</td>
        <td>${balanceChange}</td>
        <td>${tx.performed_by}</td>
        <td class="text-muted">${tx.notes || '-'}</td>
      </tr>
    `}).join('');

    } catch (error) {
        console.error('Failed to load transactions:', error);
    }
}

// Card type change handler
document.getElementById('issueType').addEventListener('change', (e) => {
    const type = e.target.value;
    const valueFields = document.getElementById('valueFields');
    const discountFields = document.getElementById('discountFields');

    if (type === 'value') {
        valueFields.classList.remove('hidden');
        discountFields.classList.add('hidden');
    } else if (type === 'discount') {
        valueFields.classList.add('hidden');
        discountFields.classList.remove('hidden');
    } else {
        valueFields.classList.remove('hidden');
        discountFields.classList.remove('hidden');
    }
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const bulkField = document.getElementById('bulkField');
        if (tabName === 'bulk') {
            bulkField.classList.remove('hidden');
        } else {
            bulkField.classList.add('hidden');
            document.getElementById('issueQuantity').value = 1;
        }
    });
});

// Issue card form
document.getElementById('issueCardForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const tier = document.getElementById('issueTier').value;
    const cardType = document.getElementById('issueType').value;
    // Remove commas before parsing (value input is comma-formatted)
    const initialValue = parseFloat(document.getElementById('issueValue').value.replace(/,/g, '')) || 0;
    const discountPercent = parseFloat(document.getElementById('issueDiscount').value) || 0;
    const discountUsesRemaining = document.getElementById('issueUses').value
        ? parseInt(document.getElementById('issueUses').value)
        : undefined;
    const expiresAt = document.getElementById('issueExpiry').value || undefined;
    const quantity = parseInt(document.getElementById('issueQuantity').value) || 1;

    const issueBtn = document.getElementById('issueBtn');
    issueBtn.disabled = true;
    issueBtn.innerHTML = 'Creating...';

    try {
        let response, data;

        if (quantity === 1) {
            response = await fetch('/api/admin/cards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    tier,
                    cardType,
                    initialValue,
                    discountPercent,
                    discountUsesRemaining,
                    expiresAt
                })
            });
            data = await response.json();

            if (!response.ok) {
                alert(data.error || 'Failed to issue card');
                return;
            }

            issuedCards = [data];
            document.getElementById('newCardCode').textContent = data.code;
            document.getElementById('singleCardResult').classList.remove('hidden');
            document.getElementById('bulkCardsResult').classList.add('hidden');

        } else {
            response = await fetch('/api/admin/cards/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    tier,
                    cardType,
                    initialValue,
                    discountPercent,
                    discountUsesRemaining,
                    expiresAt,
                    quantity
                })
            });
            data = await response.json();

            if (!response.ok) {
                alert(data.error || 'Failed to issue cards');
                return;
            }

            issuedCards = data.cards;

            const list = document.getElementById('bulkCardsList');
            list.innerHTML = data.cards.map((card, i) => `
        <div class="bulk-card-item">
          <span>${i + 1}. ${card.code}</span>
          <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('${card.code}')">Copy</button>
        </div>
      `).join('');

            document.getElementById('singleCardResult').classList.add('hidden');
            document.getElementById('bulkCardsResult').classList.remove('hidden');
        }

        document.getElementById('issueCardForm').classList.add('hidden');
        document.getElementById('issueResult').classList.remove('hidden');

        // Show success modal
        if (quantity === 1) {
            showSuccessModal(
                'Card Issued!',
                `Successfully created ${tier} ${cardType} card`,
                2500
            );
        } else {
            showSuccessModal(
                'Cards Issued!',
                `Successfully created ${quantity} ${tier} ${cardType} cards`,
                2500
            );
        }

    } catch (error) {
        alert('Network error. Please try again.');
    } finally {
        issueBtn.disabled = false;
        issueBtn.innerHTML = 'Issue Card';
    }
});

function resetIssueForm() {
    document.getElementById('issueCardForm').reset();
    document.getElementById('issueCardForm').classList.remove('hidden');
    document.getElementById('issueResult').classList.add('hidden');
    issuedCards = [];
}

function copyCode() {
    const code = document.getElementById('newCardCode').textContent;
    copyToClipboard(code);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Brief visual feedback
        const copyBtn = document.getElementById('copyCodeBtn');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 1500);
        }
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

function downloadBulkCodes() {
    const csv = 'Code,Tier,Type,Value,Discount\n' +
        issuedCards.map(c => `${c.code},${c.tier},${c.cardType},${c.initialValue},${c.discountPercent}`).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gift_cards.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Card actions
async function freezeCard(id) {
    if (!confirm('Are you sure you want to freeze this card?')) return;

    try {
        const response = await fetch(`/api/admin/cards/${id}/freeze`, { method: 'POST', credentials: 'same-origin' });
        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Failed to freeze card');
            return;
        }

        loadCards();
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

async function unfreezeCard(id) {
    if (!confirm('Are you sure you want to unfreeze this card?')) return;

    try {
        const response = await fetch(`/api/admin/cards/${id}/unfreeze`, { method: 'POST', credentials: 'same-origin' });
        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Failed to unfreeze card');
            return;
        }

        loadCards();
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

async function revokeCard(id) {
    // UI Contract: Revoke Modal copy
    if (!confirm('Revoke this card?\n\nThis can\'t be undone. The remaining balance will be lost.')) return;

    try {
        const response = await fetch(`/api/admin/cards/${id}/revoke`, { method: 'POST', credentials: 'same-origin' });
        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Failed to revoke card');
            return;
        }

        loadCards();
    } catch (error) {
        alert('Network error. Please try again.');
    }
}

async function showCardDetails(id, code) {
    const modal = document.getElementById('cardModal');
    const content = document.getElementById('modalContent');

    // Show modal loading state
    content.innerHTML = '<div class="text-center p-xl"><div class="spinner"></div></div>';
    modal.classList.add('active');

    try {
        const response = await fetch(`/api/admin/cards/${id}`, { credentials: 'same-origin' });
        const data = await response.json();
        const card = data;

        content.innerHTML = `
            <div class="gift-card-display card-shimmer" style="background: linear-gradient(145deg, #1a1a1a 0%, #0d0d0d 100%); aspect-ratio: 1.2 / 1; display: flex; flex-direction: column; justify-content: space-between; padding: 28px; border-radius: 16px; border: 1px solid rgba(162, 129, 46, 0.3);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div class="gift-card-tier" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; color: #A2812E; margin-bottom: 8px;">${card.tier}</div>
                        <div style="font-size: 0.8rem; color: #666; text-transform: capitalize;">${card.card_type} Card</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.7rem; color: #666; margin-bottom: 4px;">Status</div>
                        <div class="font-bold capitalize" style="color: ${card.status === 'active' ? '#10b981' : card.status === 'frozen' ? '#3b82f6' : '#ef4444'};">${card.status}</div>
                    </div>
                </div>
                
                <div style="text-align: center; padding: 16px 0;">
                    <div class="gift-card-balance" style="font-size: 2.5rem; font-weight: 700; color: #10b981; margin-bottom: 8px;">$${(card.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    ${card.card_type === 'discount' || card.card_type === 'hybrid' ? `
                        <div style="font-size: 1.1rem; color: #A2812E; font-weight: 600;">${card.discount_percent}% OFF</div>
                        <div style="font-size: 0.75rem; color: #666; margin-top: 4px;">${card.discount_uses_remaining === null ? 'Unlimited uses' : `${card.discount_uses_remaining} uses left`}</div>
                    ` : ''}
                </div>
                
                <div>
                    <div class="gift-card-code" style="font-family: var(--font-mono); font-size: 1rem; letter-spacing: 0.1em; color: #fff; text-align: center; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 12px;">${card.code_prefix}-••••-••••-••••</div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #666;">
                        <span>ID: ${card.id}</span>
                        <span>${card.expires_at ? `Exp: ${formatDate(card.expires_at)}` : 'No Expiry'}</span>
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                    <div style="padding: 12px; background: #111; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; color: #666; margin-bottom: 4px;">Issued</div>
                        <div style="font-weight: 600; font-size: 0.85rem;">${formatDate(card.issued_at)}</div>
                    </div>
                    <div style="padding: 12px; background: #111; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; color: #666; margin-bottom: 4px;">Initial Value</div>
                        <div style="font-weight: 600; font-size: 0.85rem;">$${(card.initial_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 0.8rem; color: #666; margin-bottom: 8px;">QR Code</div>
                    <div id="qrCodeContainer" style="padding: 16px; background: #fff; border-radius: 8px; display: inline-block;">
                        <div style="color: #999; font-size: 0.75rem;">Loading...</div>
                    </div>
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="downloadQRCode(${card.id}, '${card.code_prefix}')">
                            📥 Download QR Code
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="mt-xl flex gap-md">
                ${card.status === 'active' ? `
                    <button class="btn btn-secondary w-full" onclick="freezeCard(${card.id}); closeModal()">Freeze Card</button>
                    <button class="btn btn-danger w-full" onclick="revokeCard(${card.id}); closeModal()">Revoke Card</button>
                ` : ''}
                ${card.status === 'frozen' ? `
                    <button class="btn btn-success w-full" onclick="unfreezeCard(${card.id}); closeModal()">Unfreeze Card</button>
                    <button class="btn btn-danger w-full" onclick="revokeCard(${card.id}); closeModal()">Revoke Card</button>
                ` : ''}
            </div>
        `;

        // Load QR code after content is rendered
        loadQRCode(card.id);

    } catch (error) {
        content.innerHTML = '<div class="alert alert-error">Failed to load card details</div>';
    }
}

function closeModal() {
    document.getElementById('cardModal').classList.remove('active');
}

// Utility functions
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// QR Code functions
async function loadQRCode(cardId) {
    const container = document.getElementById('qrCodeContainer');
    if (!container) return;

    try {
        const response = await fetch(`/api/admin/cards/${cardId}/qr`, { credentials: 'same-origin' });
        const data = await response.json();

        if (data.qrCode) {
            container.innerHTML = `<img src="${data.qrCode}" alt="QR Code" style="width: 150px; height: 150px;">`;
        } else {
            container.innerHTML = '<div style="color: #f00; font-size: 0.75rem;">Failed to load</div>';
        }
    } catch (error) {
        console.error('Failed to load QR code:', error);
        container.innerHTML = '<div style="color: #f00; font-size: 0.75rem;">Error loading QR</div>';
    }
}

async function downloadQRCode(cardId, codePrefix) {
    try {
        const response = await fetch(`/api/admin/cards/${cardId}/qr?format=png`, { credentials: 'same-origin' });
        const blob = await response.blob();

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `giftcard-${codePrefix}.png`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showSuccessModal('Downloaded!', 'QR code saved to your downloads.');
    } catch (error) {
        console.error('Failed to download QR code:', error);
        alert('Failed to download QR code');
    }
}

// =============================================================
// ANALYTICS FUNCTIONS
// =============================================================
async function loadAnalytics() {
    const period = document.getElementById('analyticsPeriod')?.value || '30d';

    try {
        const response = await fetch(`/api/admin/analytics?period=${period}`, { credentials: 'same-origin' });
        const data = await response.json();

        // Update KPI cards
        document.getElementById('kpiTotalCards').textContent = data.summary.totalCards.toLocaleString();
        document.getElementById('kpiActiveBalance').textContent = `$${data.summary.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        document.getElementById('kpiRedeemed').textContent = `$${data.summary.totalRedeemed.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        document.getElementById('kpiUtilization').textContent = `${data.summary.utilizationRate}%`;

        // Render tier chart
        renderBarChart('tierChart', data.distribution.byTier.map(t => ({
            label: t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
            value: t.count,
            color: t.tier === 'vip' ? '#A2812E' : t.tier === 'premium' ? '#10b981' : '#6b7280'
        })));

        // Render type chart
        renderBarChart('typeChart', data.distribution.byType.map(t => ({
            label: t.card_type.charAt(0).toUpperCase() + t.card_type.slice(1),
            value: t.count,
            color: t.card_type === 'value' ? '#10b981' : t.card_type === 'discount' ? '#f59e0b' : '#8b5cf6'
        })));

        // Render trend chart
        renderTrendChart('trendChart', data.trends.redemptions);

        // Render recent redemptions
        const recentEl = document.getElementById('recentRedemptions');
        if (data.recent.redemptions.length === 0) {
            recentEl.innerHTML = '<div style="color: #666;">No recent redemptions</div>';
        } else {
            recentEl.innerHTML = data.recent.redemptions.map(r => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span style="color: #888;">${r.code_prefix}••••</span>
                    <span style="color: #10b981; font-weight: 600;">-$${r.amount.toFixed(2)}</span>
                </div>
            `).join('');
        }

        // Render expiring cards
        const expiringEl = document.getElementById('expiringCards');
        if (data.recent.expiring.length === 0) {
            expiringEl.innerHTML = '<div style="color: #666;">No cards expiring soon</div>';
        } else {
            expiringEl.innerHTML = data.recent.expiring.map(c => `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span style="color: #888;">${c.code_prefix}••••</span>
                    <span style="color: ${c.days_left <= 3 ? '#ef4444' : '#f59e0b'}; font-weight: 600;">${c.days_left}d left</span>
                </div>
            `).join('');
        }

    } catch (error) {
        console.error('Failed to load analytics:', error);
    }
}

function renderBarChart(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container || data.length === 0) return;

    const maxValue = Math.max(...data.map(d => d.value)) || 1;

    container.innerHTML = data.map(d => `
        <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
            <div style="font-weight: 600; margin-bottom: 8px; color: ${d.color};">${d.value}</div>
            <div style="width: 100%; max-width: 60px; background: ${d.color}; height: ${(d.value / maxValue) * 150}px; border-radius: 4px 4px 0 0; min-height: 4px;"></div>
            <div style="margin-top: 8px; font-size: 0.75rem; color: #888;">${d.label}</div>
        </div>
    `).join('');
}

function renderTrendChart(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding-top: 80px;">No data for this period</div>';
        return;
    }

    const maxValue = Math.max(...data.map(d => d.total)) || 1;

    container.innerHTML = data.map(d => {
        const height = (d.total / maxValue) * 180;
        const date = new Date(d.date);
        return `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center;" title="${date.toLocaleDateString()}: $${d.total.toFixed(2)}">
                <div style="width: 100%; background: linear-gradient(to top, #10b981, #059669); height: ${height}px; border-radius: 2px 2px 0 0; min-height: 2px;"></div>
            </div>
        `;
    }).join('');
}

// Add period change listener
document.getElementById('analyticsPeriod')?.addEventListener('change', loadAnalytics);

// =============================================================
// SUPERFANS MANAGEMENT
// =============================================================

async function loadSuperFans() {
    loadSuperFanStats();
    loadSuperFanUsers();
    loadLeaderboard();
}

async function loadSuperFanStats() {
    try {
        const response = await fetch('/api/admin/superfans/stats', { credentials: 'same-origin' });
        const stats = await response.json();

        document.getElementById('sfTotalUsers').textContent = stats.total_users || 0;
        document.getElementById('sfActiveCards').textContent = stats.active_cards || 0;
        document.getElementById('sfTotalPoints').textContent = (stats.total_points || 0).toLocaleString();
        document.getElementById('sfNewThisWeek').textContent = stats.new_this_week || 0;
    } catch (error) {
        console.error('SuperFan stats error:', error);
    }
}

async function loadSuperFanUsers() {
    const tbody = document.getElementById('superfansTableBody');
    const search = document.getElementById('superfanSearch')?.value || '';
    const tier = document.getElementById('superfanTierFilter')?.value || '';

    try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (tier) params.set('tier', tier);

        const response = await fetch(`/api/admin/superfans?${params}`, { credentials: 'same-origin' });
        const data = await response.json();

        if (data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td><strong>${escapeHtml(user.name)}</strong></td>
                <td>${escapeHtml(user.email)}</td>
                <td>${user.card_number ? `<code style="font-size:0.75rem;">${user.card_number}</code>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td>${user.tier ? `<span class="tier-badge tier-${user.tier}">${user.tier}</span>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td>${user.points != null ? user.points.toLocaleString() : '—'}</td>
                <td>${user.card_status ? `<span class="status-badge status-${user.card_status}">${user.card_status}</span>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td>${new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="viewSuperFanDetail(${user.id})">View</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Load superfans error:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">Error loading users</td></tr>';
    }
}

async function loadLeaderboard() {
    const container = document.getElementById('leaderboardList');

    try {
        const response = await fetch('/api/admin/superfans/leaderboard?limit=10', { credentials: 'same-origin' });
        const data = await response.json();

        if (!data || data.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);">No leaderboard data yet</p>';
            return;
        }

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${data.map((item, index) => `
                    <div style="display:flex;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:4px;">
                        <div style="width:30px;font-weight:700;color:${index < 3 ? '#A2812E' : '#888'};">#${index + 1}</div>
                        <div style="flex:1;">
                            <div style="font-weight:500;">${escapeHtml(item.name || 'Unknown')}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);">${item.tier || 'bronze'}</div>
                        </div>
                        <div style="font-weight:700;color:#A2812E;">${(item.lifetime_points || 0).toLocaleString()} pts</div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Leaderboard error:', error);
        container.innerHTML = '<p style="color:red;">Error loading leaderboard</p>';
    }
}

async function viewSuperFanDetail(userId) {
    try {
        const response = await fetch(`/api/admin/superfans/${userId}`, { credentials: 'same-origin' });
        const data = await response.json();

        const user = data.user;
        document.getElementById('modalTitle').textContent = user.name;
        document.getElementById('modalContent').innerHTML = `
            <div style="display:grid;gap:16px;">
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Email</div>
                    <div>${escapeHtml(user.email)}</div>
                </div>
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Phone</div>
                    <div>${user.phone || '—'}</div>
                </div>
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Loyalty Card</div>
                    <div>${user.card_number || 'No card'}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                    <div>
                        <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Points</div>
                        <div style="font-size:1.5rem;font-weight:700;color:#A2812E;">${(user.points || 0).toLocaleString()}</div>
                    </div>
                    <div>
                        <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Lifetime</div>
                        <div style="font-size:1.5rem;font-weight:700;">${(user.lifetime_points || 0).toLocaleString()}</div>
                    </div>
                </div>
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Tier</div>
                    <div><span class="tier-badge tier-${user.tier || 'bronze'}">${user.tier || 'bronze'}</span></div>
                </div>
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Status</div>
                    <div><span class="status-badge status-${user.card_status || 'pending'}">${user.card_status || 'No card'}</span></div>
                </div>
                <div>
                    <div class="text-muted" style="font-size:0.75rem;margin-bottom:4px;">Spotify</div>
                    <div>${user.spotify_user_id ? '✅ Connected' : '❌ Not connected'}</div>
                </div>
                <hr style="border-color:rgba(255,255,255,0.1);">
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-primary" onclick="addPointsToUser(${userId})">Add Points</button>
                    <button class="btn btn-secondary" onclick="toggleUserCardStatus(${userId})">
                        ${user.card_status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                </div>
            </div>
        `;

        document.getElementById('cardModal').classList.add('active');
    } catch (error) {
        console.error('View user error:', error);
        alert('Failed to load user details');
    }
}

async function addPointsToUser(userId) {
    const amount = prompt('Enter points to add (use negative for deduction):');
    if (!amount) return;

    const points = parseInt(amount);
    if (isNaN(points)) {
        alert('Please enter a valid number');
        return;
    }

    const description = prompt('Description (optional):') || 'Admin adjustment';

    try {
        const response = await fetch(`/api/admin/superfans/${userId}/points`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ amount: points, description })
        });

        const data = await response.json();

        if (response.ok) {
            showSuccessModal('Points Added', `${points > 0 ? '+' : ''}${points} points`);
            closeModal();
            loadSuperFanUsers();
        } else {
            alert(data.error || 'Failed to add points');
        }
    } catch (error) {
        console.error('Add points error:', error);
        alert('Network error');
    }
}

async function toggleUserCardStatus(userId) {
    if (!confirm('Toggle this user\'s card status?')) return;

    try {
        const response = await fetch(`/api/admin/superfans/${userId}/toggle-status`, {
            method: 'POST',
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (response.ok) {
            showSuccessModal('Status Updated', `Card is now ${data.newStatus}`);
            closeModal();
            loadSuperFanUsers();
        } else {
            alert(data.error || 'Failed to update status');
        }
    } catch (error) {
        console.error('Toggle status error:', error);
        alert('Network error');
    }
}

// Helper function for HTML escaping
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// SuperFan search/filter handlers
document.getElementById('superfanSearch')?.addEventListener('input', debounce(loadSuperFanUsers, 300));
document.getElementById('superfanTierFilter')?.addEventListener('change', loadSuperFanUsers);

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

