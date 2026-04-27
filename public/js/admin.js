// Admin Dashboard JavaScript

let currentAdmin = null;
let issuedCards = [];

// =====================================================================
// M3-1 — Skeleton row helper. Paints N placeholder rows with shimmering
// `.skeleton` blocks while a fetch is pending; the existing render
// functions overwrite the tbody.innerHTML on success or empty.
// CSS: .skeleton / .skeleton-row in /css/mobile.css.
// =====================================================================
function paintSkeletonRows(tbodyId, rowCount, colCount) {
    const tbody = typeof tbodyId === 'string'
        ? document.getElementById(tbodyId)
        : tbodyId;
    if (!tbody) return;
    let html = '';
    for (let r = 0; r < rowCount; r++) {
        html += '<tr class="skeleton-row" aria-hidden="true">';
        for (let c = 0; c < colCount; c++) {
            html += '<td><div class="skeleton skeleton-text"></div></td>';
        }
        html += '</tr>';
    }
    tbody.innerHTML = html;
}

// =====================================================================
// H2 — Auth-expiry handler. When any admin fetch returns 401, reload the
// page; checkSession() runs on DOMContentLoaded and naturally swaps the
// loginScreen back into view because the server reports not authenticated.
// Returns true if a 401 was handled — callers must `return` immediately.
// =====================================================================
function handleAuthExpired(res) {
    if (res.status !== 401) return false;
    alert('Your admin session has expired. Please log in again.');
    location.reload();
    return true;
}

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

// Page navigation (delegated so drawer clones in mobile nav also work)
document.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item[data-page]');
    if (!item) return;
    const page = item.dataset.page;
    if (page) showPage(page);
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
document.getElementById('importCsvBtn')?.addEventListener('click', () => document.getElementById('importCsvInput')?.click());
document.getElementById('newCampaignBtn')?.addEventListener('click', () => showCreateCampaignModal());
document.getElementById('closeCampaignModalBtn')?.addEventListener('click', () => closeCampaignModal());


function showPage(page) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById(`${page}Page`).classList.remove('hidden');

    // Load data
    if (page === 'dashboard') loadStats();
    if (page === 'cards') loadCards();
    if (page === 'transactions') loadTransactions();
    if (page === 'admin-audit') loadAdminAudit({ resetPage: true });
    if (page === 'analytics') loadAnalytics();
    if (page === 'loyalty') loadLoyaltyStats();
    if (page === 'superfans') loadSuperFans();
    if (page === 'promos') { /* No load needed for form */ }
    if (page === 'campaigns') loadEngagementCampaigns();
    if (page === 'tasks') loadTasksPage();
    if (page === 'verifications') loadVerifications();
    if (page === 'rewards') loadRewardsPage();
}

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
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (handleAuthExpired(response)) return;

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
            // M3-5: empty-state with SVG illustration
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 11l18-5v12L3 14v-3z"/>
                                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
                            </svg>
                            <div class="empty-state__title">No campaigns yet</div>
                            <div class="empty-state__description">Create a campaign to start engaging your superfans.</div>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = campaigns.map(c => `
            <tr>
                <td data-label="Title"><strong>${c.title}</strong></td>
                <td data-label="Type"><span class="badge badge-info">${c.type}</span></td>
                <td data-label="Points">${c.points} pts</td>
                <td data-label="Status"><span class="badge badge-${c.status === 'active' ? 'active' : 'frozen'}">${c.status}</span></td>
                <td data-label="Start Date">${formatDate(c.starts_at) || '-'}</td>
                <td data-label="End Date">${formatDate(c.ends_at) || '-'}</td>
                <td data-label="Actions">
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
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (handleAuthExpired(res)) return;

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
                credentials: 'same-origin',
                headers: { 'Content-Type': 'text/csv' },
                body: csvContent // Send raw CSV content
            });

            if (handleAuthExpired(response)) return;

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
        <td data-label="Time">${formatDate(tx.performed_at)}</td>
        <td data-label="Card" class="font-mono">${tx.code_prefix}••••</td>
        <td data-label="Type"><span class="badge badge-${tx.type === 'redeem' ? 'value' : tx.type === 'issue' ? 'active' : 'discount'}">${tx.type}</span></td>
        <td data-label="Amount">${tx.amount ? `$${tx.amount.toFixed(2)}` : tx.discount_applied ? `$${tx.discount_applied.toFixed(2)}` : '-'}</td>
        <td data-label="By">${tx.performed_by}</td>
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

    // M3-1: paint skeleton rows while the fetch is in flight.
    paintSkeletonRows('cardsTableBody', 5, 9);

    try {
        const response = await fetch(`/api/admin/cards?${params}`, { credentials: 'same-origin' });
        const data = await response.json();

        // Debug: log first card to see data structure
        console.log('Cards API response:', data.cards?.[0]);

        const tbody = document.getElementById('cardsTableBody');

        // Empty state per UI Contract
        if (!data.cards || data.cards.length === 0) {
            // M3-5: empty-state with SVG illustration
            tbody.innerHTML = `
                <tr>
                    <td colspan="9">
                        <div class="empty-state">
                            <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="2" y="5" width="20" height="14" rx="2"/>
                                <line x1="2" y1="10" x2="22" y2="10"/>
                                <line x1="6" y1="15" x2="10" y2="15"/>
                            </svg>
                            <div class="empty-state__title">No gift cards yet</div>
                            <div class="empty-state__description">Issue your first card to start tracking redemptions.</div>
                            <button class="btn btn-primary" onclick="showPage('issue')">Issue First Card</button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.cards.map(card => `
      <tr class="card-row" data-card-id="${card.id}" data-card-code="${card.code_prefix}-****-****-****" style="cursor:pointer;">
        <td data-label="ID">${card.id}</td>
        <td data-label="Code" class="font-mono">${card.code_prefix}••••</td>
        <td data-label="Tier"><span class="badge badge-${card.tier}">${card.tier}</span></td>
        <td data-label="Type"><span class="badge badge-${card.card_type}">${card.card_type}</span></td>
        <td data-label="Balance">$${(card.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="Discount">${card.discount_percent > 0 ? `${card.discount_percent}%` : '-'}</td>
        <td data-label="Status"><span class="badge badge-${card.status}">${card.status}</span></td>
        <td data-label="Issued">${formatDate(card.issued_at)}</td>
        <td data-label="Actions">
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

    // M3-1: paint skeleton rows while the fetch is in flight.
    paintSkeletonRows('transactionsTableBody', 5, 6);

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
        <td data-label="Time">${formatDate(tx.performed_at)}</td>
        <td data-label="Card" class="font-mono">${tx.code_prefix}••••</td>
        <td data-label="Type"><span class="badge badge-${tx.type === 'redeem' ? 'value' : tx.type === 'issue' ? 'active' : 'discount'}">${tx.type}</span></td>
        <td data-label="Amount">${tx.amount ? `$${tx.amount.toFixed(2)}` : tx.discount_applied ? `$${tx.discount_applied.toFixed(2)}` : '-'}</td>
        <td data-label="Balance Change">${balanceChange}</td>
        <td data-label="By">${tx.performed_by}</td>
        <td data-label="Notes" class="text-muted">${tx.notes || '-'}</td>
      </tr>
    `}).join('');

    } catch (error) {
        console.error('Failed to load transactions:', error);
    }
}

// =============================================================
// ADMIN AUDIT LOG (T0-6)
// =============================================================
const ADMIN_AUDIT_PAGE_SIZE = 50;
let adminAuditOffset = 0;
let adminAuditActionsLoaded = false;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadAdminAuditActionsDropdown() {
    if (adminAuditActionsLoaded) return;
    try {
        const res = await fetch('/api/admin/audit-log/actions', { credentials: 'same-origin' });
        if (!res.ok) return;
        const actions = await res.json();
        const select = document.getElementById('adminAuditActionFilter');
        if (!select) return;
        // Preserve the "All Actions" default option
        select.innerHTML = '<option value="">All Actions</option>' +
            actions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        adminAuditActionsLoaded = true;
    } catch (err) {
        console.error('Failed to load audit actions:', err);
    }
}

async function loadAdminAudit({ resetPage = false } = {}) {
    if (resetPage) adminAuditOffset = 0;
    loadAdminAuditActionsDropdown();

    const tbody = document.getElementById('adminAuditTableBody');
    if (!tbody) return;
    // M3-1: skeleton rows feel less jarring than a single "Loading..." row.
    paintSkeletonRows(tbody, 6, 7);

    const action = document.getElementById('adminAuditActionFilter')?.value || '';
    const entityType = document.getElementById('adminAuditEntityFilter')?.value || '';
    const since = document.getElementById('adminAuditSinceFilter')?.value || '';
    const until = document.getElementById('adminAuditUntilFilter')?.value || '';

    const params = new URLSearchParams();
    params.set('limit', ADMIN_AUDIT_PAGE_SIZE);
    params.set('offset', adminAuditOffset);
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (since) params.set('since', since);
    if (until) params.set('until', until);

    try {
        const res = await fetch(`/api/admin/audit-log?${params.toString()}`, { credentials: 'same-origin' });
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Failed to load audit log.</td></tr>';
            return;
        }
        const { rows, total, limit, offset } = await res.json();

        if (!rows.length) {
            // M3-5: empty-state with search SVG illustration
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="11" cy="11" r="7"/>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            </svg>
                            <div class="empty-state__title">No audit entries</div>
                            <div class="empty-state__description">No entries match the current filter. Try widening the date range.</div>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = rows.map(r => {
                // M2-3: collapse the JSON payload into a native <details>
                // disclosure so it doesn't dominate the row on mobile and
                // gets free a11y semantics (VoiceOver: "summary, collapsed").
                const detailsStr = r.details
                    ? `<details class="audit-details">
                        <summary>View payload</summary>
                        <pre><code>${escapeHtml(JSON.stringify(r.details, null, 2))}</code></pre>
                       </details>`
                    : '<span class="text-muted">—</span>';
                return `
                    <tr>
                        <td data-label="Time">${formatDate(r.created_at)}</td>
                        <td data-label="Admin">${escapeHtml(r.admin_username || `id:${r.admin_id ?? '—'}`)}</td>
                        <td data-label="Action"><span class="badge badge-discount">${escapeHtml(r.action)}</span></td>
                        <td data-label="Entity">${escapeHtml(r.entity_type || '—')}</td>
                        <td data-label="Entity ID" class="font-mono">${escapeHtml(r.entity_id || '—')}</td>
                        <td data-label="Details" style="max-width:320px;">${detailsStr}</td>
                        <td data-label="IP" class="text-muted font-mono" style="font-size:0.8rem;">${escapeHtml(r.ip_address || '—')}</td>
                    </tr>
                `;
            }).join('');
        }

        const totalEl = document.getElementById('adminAuditTotalCount');
        if (totalEl) totalEl.textContent = total ? `${total.toLocaleString()} total` : '';
        const info = document.getElementById('adminAuditPageInfo');
        if (info) {
            const from = total === 0 ? 0 : offset + 1;
            const to = Math.min(offset + rows.length, total);
            info.textContent = `${from}–${to} of ${total}`;
        }
        const prev = document.getElementById('adminAuditPrevBtn');
        const next = document.getElementById('adminAuditNextBtn');
        if (prev) prev.disabled = offset === 0;
        if (next) next.disabled = offset + rows.length >= total;

        // M2-9 — announce filter result count for screen readers.
        const sr = document.getElementById('admin-audit-sr');
        if (sr) {
            sr.textContent = total === 0
                ? 'No audit entries match the current filter.'
                : `Showing ${rows.length} of ${total.toLocaleString()} audit ${total === 1 ? 'entry' : 'entries'}.`;
        }
    } catch (err) {
        console.error('Failed to load admin audit log:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Failed to load audit log.</td></tr>';
    }
}

document.getElementById('applyAdminAuditFiltersBtn')?.addEventListener('click', () => loadAdminAudit({ resetPage: true }));
document.getElementById('resetAdminAuditFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('adminAuditActionFilter').value = '';
    document.getElementById('adminAuditEntityFilter').value = '';
    document.getElementById('adminAuditSinceFilter').value = '';
    document.getElementById('adminAuditUntilFilter').value = '';
    loadAdminAudit({ resetPage: true });
});
document.getElementById('adminAuditPrevBtn')?.addEventListener('click', () => {
    adminAuditOffset = Math.max(0, adminAuditOffset - ADMIN_AUDIT_PAGE_SIZE);
    loadAdminAudit();
});
document.getElementById('adminAuditNextBtn')?.addEventListener('click', () => {
    adminAuditOffset += ADMIN_AUDIT_PAGE_SIZE;
    loadAdminAudit();
});

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
                        <div class="gift-card-tier" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--accent-text, var(--accent)); margin-bottom: 8px;">${card.tier}</div>
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
                        <div style="font-size: 1.1rem; color: var(--accent-text, var(--accent)); font-weight: 600;">${card.discount_percent}% OFF</div>
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

    // Also refresh fan analytics block (separate endpoint, won't fail entire page if missing)
    loadFanAnalytics();
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

    // M3-1: skeleton rows during fetch.
    paintSkeletonRows(tbody, 5, 8);

    try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (tier) params.set('tier', tier);

        const response = await fetch(`/api/admin/superfans?${params}`, { credentials: 'same-origin' });
        const data = await response.json();

        if (data.users.length === 0) {
            // M3-5: empty-state with people SVG illustration
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="empty-state">
                            <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                            </svg>
                            <div class="empty-state__title">No users found</div>
                            <div class="empty-state__description">Adjust the search or tier filter to find users.</div>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td data-label="User"><strong>${escapeHtml(user.name)}</strong></td>
                <td data-label="Email">${escapeHtml(user.email)}</td>
                <td data-label="Card #">${user.card_number ? `<code style="font-size:0.75rem;">${user.card_number}</code>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td data-label="Tier">${user.tier ? `<span class="tier-badge tier-${user.tier}">${user.tier}</span>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td data-label="Points">${user.points != null ? user.points.toLocaleString() : '—'}</td>
                <td data-label="Status">${user.card_status ? `<span class="status-badge status-${user.card_status}">${user.card_status}</span>` : '<span style="color:var(--text-muted);">—</span>'}</td>
                <td data-label="Joined">${new Date(user.created_at).toLocaleDateString()}</td>
                <td data-label="Actions">
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

        // Auth expiry → redirect to login (same pattern as campaign/import handlers)
        if (handleAuthExpired(response)) return;

        // Try to parse the body even on error responses so we can surface
        // the actual server-side error message instead of a generic string.
        let data = null;
        try { data = await response.json(); } catch (_) { /* non-JSON body */ }

        if (!response.ok) {
            const serverMsg = (data && data.error) ? data.error : `HTTP ${response.status}`;
            console.error('Leaderboard error:', response.status, data);
            container.innerHTML = `<p style="color:red;">Error loading leaderboard: ${escapeHtml(serverMsg)}</p>`;
            return;
        }

        if (!Array.isArray(data) || data.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);">No leaderboard data yet</p>';
            return;
        }

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${data.map((item, index) => `
                    <div style="display:flex;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:4px;">
                        <div style="width:30px;font-weight:700;color:${index < 3 ? 'var(--accent-text, var(--accent))' : 'var(--text-muted)'};">#${index + 1}</div>
                        <div style="flex:1;">
                            <div style="font-weight:500;">${escapeHtml(item.name || 'Unknown')}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);">${item.tier || 'bronze'}</div>
                        </div>
                        <div style="font-weight:700;color:var(--accent-text, var(--accent));">${(item.lifetime_points || 0).toLocaleString()} pts</div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Leaderboard error:', error);
        container.innerHTML = `<p style="color:red;">Error loading leaderboard: ${escapeHtml(error.message || 'Network error')}</p>`;
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
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent-text, var(--accent));">${(user.points || 0).toLocaleString()}</div>
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

// =====================================================================
// TIER 1 — TASKS / VERIFICATIONS / REWARDS / FAN ANALYTICS / LEADERBOARD
// =====================================================================

// ─── TASKS PAGE ──────────────────────────────────────────────────────
async function loadTasksPage() {
    // Activate first tab and load all three sources up-front so users can
    // switch tabs without waiting on a per-tab fetch.
    switchTasksTab('list');
    loadTaskStats();
    loadTasks();
    loadMultipliers();
    loadTaskFraud();
}

function switchTasksTab(name) {
    document.querySelectorAll('[data-tasks-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tasksTab === name);
    });
    document.getElementById('tasksTabList')?.classList.toggle('hidden', name !== 'list');
    document.getElementById('tasksTabMultipliers')?.classList.toggle('hidden', name !== 'multipliers');
    document.getElementById('tasksTabFraud')?.classList.toggle('hidden', name !== 'fraud');
}

async function loadTaskStats() {
    try {
        const res = await fetch('/api/admin/tasks/stats', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) return;
        const stats = await res.json();
        document.getElementById('taskStatTotal').textContent = (stats.total_tasks ?? stats.total ?? 0).toLocaleString();
        document.getElementById('taskStatActive').textContent = (stats.active_tasks ?? stats.active ?? 0).toLocaleString();
        document.getElementById('taskStatCompletions').textContent = (stats.total_completions ?? stats.completions ?? 0).toLocaleString();
    } catch (e) {
        console.error('Task stats error:', e);
    }
}

async function loadTasks() {
    const tbody = document.getElementById('tasksTableBody');
    if (!tbody) return;
    paintSkeletonRows(tbody, 4, 8);
    try {
        const status = document.getElementById('taskStatusFilter')?.value || '';
        const type = document.getElementById('taskTypeFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (type) params.set('type', type);
        const res = await fetch(`/api/admin/tasks?${params.toString()}`, { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">Failed to load tasks</td></tr>';
            return;
        }
        const tasks = await res.json();
        if (!Array.isArray(tasks) || tasks.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="8">
                    <div class="empty-state">
                        <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M9 11l3 3L22 4"/>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                        </svg>
                        <div class="empty-state__title">No tasks yet</div>
                        <div class="empty-state__description">Create your first community task to start engaging fans.</div>
                    </div>
                </td></tr>`;
            return;
        }
        tbody.innerHTML = tasks.map(t => `
            <tr>
                <td data-label="Title"><strong>${escapeHtml(t.title)}</strong></td>
                <td data-label="Type"><span class="badge badge-info">${escapeHtml(t.type || '')}</span></td>
                <td data-label="Points">${(t.points || 0).toLocaleString()}</td>
                <td data-label="Difficulty">${escapeHtml(t.difficulty || 'easy')}</td>
                <td data-label="Status"><span class="badge badge-${t.status === 'active' ? 'active' : 'frozen'}">${escapeHtml(t.status || '')}</span></td>
                <td data-label="Proof">${escapeHtml(t.required_proof || 'none')}</td>
                <td data-label="Created">${formatDate(t.created_at) || '-'}</td>
                <td data-label="Actions">
                    <button class="btn btn-sm btn-secondary" onclick='editTask(${JSON.stringify(t)})'>Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTask(${t.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Load tasks error:', e);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">Network error</td></tr>';
    }
}

function showCreateTaskModal() {
    document.getElementById('taskModalTitle').textContent = 'Create Task';
    document.getElementById('taskSubmitBtn').textContent = 'Create Task';
    document.getElementById('taskForm')?.reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskModal').classList.add('active');
}

function editTask(task) {
    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskSubmitBtn').textContent = 'Save Changes';
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskType').value = task.type || 'streaming';
    document.getElementById('taskCategory').value = task.category || 'general';
    document.getElementById('taskPoints').value = task.points || 0;
    document.getElementById('taskXp').value = task.xp || 0;
    document.getElementById('taskDifficulty').value = task.difficulty || 'easy';
    document.getElementById('taskProof').value = task.required_proof || 'none';
    document.getElementById('taskTargetUrl').value = task.target_url || '';
    document.getElementById('taskTargetHashtag').value = task.target_hashtag || '';
    document.getElementById('taskMaxCompletions').value = task.max_completions || 1;
    document.getElementById('taskStatus').value = task.status || 'active';
    document.getElementById('taskStartDate').value = task.start_date ? task.start_date.split('T')[0] : '';
    document.getElementById('taskEndDate').value = task.end_date ? task.end_date.split('T')[0] : '';
    document.getElementById('taskModal').classList.add('active');
}

function closeTaskModal() {
    document.getElementById('taskModal')?.classList.remove('active');
}

async function submitTaskForm(e) {
    e.preventDefault();
    const id = document.getElementById('taskId').value;
    const isEdit = !!id;
    const payload = {
        title: document.getElementById('taskTitle').value.trim(),
        description: document.getElementById('taskDescription').value.trim(),
        type: document.getElementById('taskType').value,
        category: document.getElementById('taskCategory').value.trim() || 'general',
        points: parseInt(document.getElementById('taskPoints').value) || 0,
        xp: parseInt(document.getElementById('taskXp').value) || 0,
        difficulty: document.getElementById('taskDifficulty').value,
        requiredProof: document.getElementById('taskProof').value,
        targetUrl: document.getElementById('taskTargetUrl').value.trim() || null,
        targetHashtag: document.getElementById('taskTargetHashtag').value.trim() || null,
        maxCompletions: parseInt(document.getElementById('taskMaxCompletions').value) || 1,
        startDate: document.getElementById('taskStartDate').value || null,
        endDate: document.getElementById('taskEndDate').value || null
    };
    if (isEdit) {
        // PUT uses snake_case (allowed list); translate
        payload.required_proof = payload.requiredProof; delete payload.requiredProof;
        payload.target_url = payload.targetUrl; delete payload.targetUrl;
        payload.target_hashtag = payload.targetHashtag; delete payload.targetHashtag;
        payload.max_completions = payload.maxCompletions; delete payload.maxCompletions;
        payload.start_date = payload.startDate; delete payload.startDate;
        payload.end_date = payload.endDate; delete payload.endDate;
        payload.status = document.getElementById('taskStatus').value;
    }
    try {
        const res = await fetch(`/api/admin/tasks${isEdit ? `/${id}` : ''}`, {
            method: isEdit ? 'PUT' : 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || 'Failed to save task');
            return;
        }
        showSuccessModal(isEdit ? 'Task Updated' : 'Task Created', data.title || payload.title);
        closeTaskModal();
        loadTasks();
        loadTaskStats();
    } catch (e) {
        console.error('Save task error:', e);
        alert('Network error');
    }
}

async function deleteTask(id) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    try {
        const res = await fetch(`/api/admin/tasks/${id}`, {
            method: 'DELETE', credentials: 'same-origin'
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || 'Failed to delete task (superadmin required)');
            return;
        }
        showSuccessModal('Task Deleted', `Task #${id} removed`);
        loadTasks();
        loadTaskStats();
    } catch (e) {
        console.error('Delete task error:', e);
        alert('Network error');
    }
}

// ─── MULTIPLIERS ─────────────────────────────────────────────────────
async function loadMultipliers() {
    const tbody = document.getElementById('multipliersTableBody');
    if (!tbody) return;
    paintSkeletonRows(tbody, 3, 7);
    try {
        const res = await fetch('/api/admin/multipliers', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">Failed to load multipliers</td></tr>';
            return;
        }
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="7">
                    <div class="empty-state">
                        <div class="empty-state__title">No multipliers configured</div>
                        <div class="empty-state__description">Multipliers boost task points during a campaign window.</div>
                    </div>
                </td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(m => `
            <tr>
                <td data-label="Title"><strong>${escapeHtml(m.title)}</strong></td>
                <td data-label="Multiplier">×${m.multiplier}</td>
                <td data-label="Applies To">${escapeHtml(m.applies_to || 'all')}</td>
                <td data-label="Start">${formatDate(m.start_date) || '-'}</td>
                <td data-label="End">${formatDate(m.end_date) || '-'}</td>
                <td data-label="Created By">${escapeHtml(m.created_by || '-')}</td>
                <td data-label="Actions">
                    <button class="btn btn-sm btn-danger" onclick="deleteMultiplier(${m.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Load multipliers error:', e);
    }
}

function showCreateMultiplierModal() {
    document.getElementById('multiplierForm')?.reset();
    document.getElementById('multiplierModal').classList.add('active');
}

function closeMultiplierModal() {
    document.getElementById('multiplierModal')?.classList.remove('active');
}

async function submitMultiplierForm(e) {
    e.preventDefault();
    const payload = {
        title: document.getElementById('multTitle').value.trim(),
        multiplier: parseFloat(document.getElementById('multValue').value) || 1.5,
        appliesTo: document.getElementById('multAppliesTo').value,
        startDate: document.getElementById('multStartDate').value,
        endDate: document.getElementById('multEndDate').value
    };
    try {
        const res = await fetch('/api/admin/multipliers', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.error || 'Failed to create multiplier'); return; }
        showSuccessModal('Multiplier Created', `×${payload.multiplier} on ${payload.appliesTo}`);
        closeMultiplierModal();
        loadMultipliers();
    } catch (e) {
        console.error('Save multiplier error:', e);
        alert('Network error');
    }
}

async function deleteMultiplier(id) {
    if (!confirm('Delete this multiplier?')) return;
    try {
        const res = await fetch(`/api/admin/multipliers/${id}`, {
            method: 'DELETE', credentials: 'same-origin'
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.error || 'Failed to delete multiplier (superadmin required)'); return; }
        showSuccessModal('Multiplier Deleted', `#${id} removed`);
        loadMultipliers();
    } catch (e) {
        console.error('Delete multiplier error:', e);
        alert('Network error');
    }
}

// ─── TASK FRAUD ──────────────────────────────────────────────────────
async function loadTaskFraud() {
    const tbody = document.getElementById('taskFraudTableBody');
    const summaryEl = document.getElementById('taskFraudSummary');
    const fraudCount = document.getElementById('taskStatFraud');
    if (!tbody) return;
    paintSkeletonRows(tbody, 3, 6);
    try {
        const res = await fetch('/api/admin/task-fraud', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Failed to load fraud data</td></tr>';
            return;
        }
        const { summary = {}, flags = [] } = await res.json();
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
                    <div><strong>${summary.open_flags ?? 0}</strong><div class="text-muted" style="font-size:0.75rem;">Open Flags</div></div>
                    <div><strong>${summary.resolved_flags ?? 0}</strong><div class="text-muted" style="font-size:0.75rem;">Resolved</div></div>
                    <div><strong>${summary.high_severity ?? 0}</strong><div class="text-muted" style="font-size:0.75rem;">High Severity</div></div>
                </div>`;
        }
        if (fraudCount) fraudCount.textContent = (summary.open_flags ?? 0).toLocaleString();
        if (!flags.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No open fraud flags 🎉</td></tr>';
            return;
        }
        tbody.innerHTML = flags.map(f => `
            <tr>
                <td data-label="Flagged">${formatDate(f.created_at) || '-'}</td>
                <td data-label="User">#${f.user_id}</td>
                <td data-label="Reason">${escapeHtml(f.reason || '-')}</td>
                <td data-label="Severity"><span class="badge badge-${f.severity === 'high' ? 'revoked' : 'frozen'}">${escapeHtml(f.severity || 'low')}</span></td>
                <td data-label="Details" class="text-muted" style="max-width:240px;">${escapeHtml((f.details || '').slice(0, 120))}</td>
                <td data-label="Actions">
                    <button class="btn btn-sm btn-success" onclick="resolveTaskFraud(${f.id}, 'reviewed')">Resolve</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Load fraud error:', e);
    }
}

async function resolveTaskFraud(id, resolution) {
    const notes = prompt('Resolution notes (optional):') || '';
    try {
        const res = await fetch(`/api/admin/task-fraud/${id}/resolve`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution, notes })
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.error || 'Failed to resolve flag'); return; }
        showSuccessModal('Flag Resolved', `#${id} marked ${resolution}`);
        loadTaskFraud();
    } catch (e) {
        console.error('Resolve fraud error:', e);
        alert('Network error');
    }
}

// ─── VERIFICATIONS ───────────────────────────────────────────────────
async function loadVerifications() {
    const tbody = document.getElementById('verificationsTableBody');
    if (!tbody) return;
    paintSkeletonRows(tbody, 4, 6);
    try {
        const res = await fetch('/api/admin/verifications', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Failed to load verifications</td></tr>';
            return;
        }
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6">
                    <div class="empty-state">
                        <svg class="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9 12l2 2 4-4"/>
                        </svg>
                        <div class="empty-state__title">Queue is clear</div>
                        <div class="empty-state__description">No verifications waiting for manual review.</div>
                    </div>
                </td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(v => {
            const proofPreview = v.proof_url
                ? `<a href="${escapeHtml(v.proof_url)}" target="_blank" rel="noopener noreferrer">Open Link</a>`
                : v.proof_data
                    ? `<code style="font-size:0.75rem;">${escapeHtml(String(v.proof_data).slice(0, 80))}</code>`
                    : '<span class="text-muted">—</span>';
            const autoResult = v.auto_result == null
                ? '<span class="text-muted">pending</span>'
                : v.auto_result
                    ? '<span class="badge badge-active">passed</span>'
                    : '<span class="badge badge-revoked">failed</span>';
            return `
                <tr>
                    <td data-label="Submitted">${formatDate(v.created_at) || '-'}</td>
                    <td data-label="User"><strong>${escapeHtml(v.user_name || '')}</strong><br><span class="text-muted" style="font-size:0.75rem;">${escapeHtml(v.email || '')}</span></td>
                    <td data-label="Task">${escapeHtml(v.task_title || '')}<br><span class="text-muted" style="font-size:0.75rem;">${escapeHtml(v.task_type || '')}</span></td>
                    <td data-label="Proof">${proofPreview}</td>
                    <td data-label="Auto-Result">${autoResult}</td>
                    <td data-label="Actions">
                        <button class="btn btn-sm btn-success" onclick="reviewVerification(${v.id}, 'approved')">Approve</button>
                        <button class="btn btn-sm btn-danger" onclick="reviewVerification(${v.id}, 'rejected')">Reject</button>
                    </td>
                </tr>`;
        }).join('');
    } catch (e) {
        console.error('Load verifications error:', e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Network error</td></tr>';
    }
}

async function reviewVerification(id, result) {
    const notes = prompt(`Notes for ${result} (optional):`) || '';
    try {
        const res = await fetch(`/api/admin/verifications/${id}/review`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result, notes })
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.error || 'Failed to review verification'); return; }
        showSuccessModal('Verification Reviewed', `#${id} ${result}`);
        loadVerifications();
    } catch (e) {
        console.error('Review verification error:', e);
        alert('Network error');
    }
}

// ─── REWARDS ─────────────────────────────────────────────────────────
async function loadRewardsPage() {
    loadRewardStats();
    loadRewards();
}

async function loadRewardStats() {
    try {
        const res = await fetch('/api/admin/rewards/stats', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) return;
        const stats = await res.json();
        document.getElementById('rewardStatTotal').textContent = (stats.total_rewards ?? stats.total ?? 0).toLocaleString();
        document.getElementById('rewardStatActive').textContent = (stats.active_rewards ?? stats.active ?? 0).toLocaleString();
        document.getElementById('rewardStatRedemptions').textContent = (stats.total_redemptions ?? stats.redemptions ?? 0).toLocaleString();
        document.getElementById('rewardStatPoints').textContent = (stats.total_points_spent ?? stats.points_spent ?? 0).toLocaleString();
    } catch (e) {
        console.error('Reward stats error:', e);
    }
}

async function loadRewards() {
    const tbody = document.getElementById('rewardsTableBody');
    if (!tbody) return;
    paintSkeletonRows(tbody, 4, 7);
    try {
        const res = await fetch('/api/admin/rewards', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">Failed to load rewards</td></tr>';
            return;
        }
        const rewards = await res.json();
        if (!Array.isArray(rewards) || rewards.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="7">
                    <div class="empty-state">
                        <div class="empty-state__title">No rewards yet</div>
                        <div class="empty-state__description">Add the first reward fans can redeem with points.</div>
                    </div>
                </td></tr>`;
            return;
        }
        tbody.innerHTML = rewards.map(r => `
            <tr>
                <td data-label="Title"><strong>${escapeHtml(r.title)}</strong></td>
                <td data-label="Category">${escapeHtml(r.category || '-')}</td>
                <td data-label="Cost">${(r.points_cost || 0).toLocaleString()} pts</td>
                <td data-label="Tier">${escapeHtml(r.tier_required || 'fan')}</td>
                <td data-label="Inventory">${r.inventory === -1 ? '∞' : (r.inventory ?? 0)}</td>
                <td data-label="Active">${r.is_active ? '<span class="badge badge-active">active</span>' : '<span class="badge badge-frozen">paused</span>'}</td>
                <td data-label="Actions">
                    <button class="btn btn-sm btn-secondary" onclick='editReward(${JSON.stringify(r)})'>Edit</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Load rewards error:', e);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">Network error</td></tr>';
    }
}

function showCreateRewardModal() {
    document.getElementById('rewardModalTitle').textContent = 'Create Reward';
    document.getElementById('rewardSubmitBtn').textContent = 'Create Reward';
    document.getElementById('rewardForm')?.reset();
    document.getElementById('rewardId').value = '';
    document.getElementById('rewardModal').classList.add('active');
}

function editReward(reward) {
    document.getElementById('rewardModalTitle').textContent = 'Edit Reward';
    document.getElementById('rewardSubmitBtn').textContent = 'Save Changes';
    document.getElementById('rewardId').value = reward.id;
    document.getElementById('rewardTitle').value = reward.title || '';
    document.getElementById('rewardDescription').value = reward.description || '';
    document.getElementById('rewardCategory').value = reward.category || 'general';
    document.getElementById('rewardTier').value = reward.tier_required || 'fan';
    document.getElementById('rewardCost').value = reward.points_cost || 0;
    document.getElementById('rewardInventory').value = reward.inventory ?? -1;
    document.getElementById('rewardImage').value = reward.image_url || '';
    document.getElementById('rewardInstructions').value = reward.redemption_instructions || '';
    document.getElementById('rewardModal').classList.add('active');
}

function closeRewardModal() {
    document.getElementById('rewardModal')?.classList.remove('active');
}

async function submitRewardForm(e) {
    e.preventDefault();
    const id = document.getElementById('rewardId').value;
    const isEdit = !!id;
    // POST uses camelCase, PUT uses snake_case (allowed list)
    const base = {
        title: document.getElementById('rewardTitle').value.trim(),
        description: document.getElementById('rewardDescription').value.trim(),
        category: document.getElementById('rewardCategory').value,
        pointsCost: parseInt(document.getElementById('rewardCost').value) || 0,
        tierRequired: document.getElementById('rewardTier').value,
        inventory: parseInt(document.getElementById('rewardInventory').value) || -1,
        imageUrl: document.getElementById('rewardImage').value.trim() || null,
        redemptionInstructions: document.getElementById('rewardInstructions').value.trim()
    };
    let payload = base;
    if (isEdit) {
        payload = {
            title: base.title,
            description: base.description,
            category: base.category,
            points_cost: base.pointsCost,
            tier_required: base.tierRequired,
            inventory: base.inventory,
            image_url: base.imageUrl,
            redemption_instructions: base.redemptionInstructions
        };
    }
    try {
        const res = await fetch(`/api/admin/rewards${isEdit ? `/${id}` : ''}`, {
            method: isEdit ? 'PUT' : 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { alert(data.error || 'Failed to save reward'); return; }
        showSuccessModal(isEdit ? 'Reward Updated' : 'Reward Created', data.title || base.title);
        closeRewardModal();
        loadRewards();
        loadRewardStats();
    } catch (e) {
        console.error('Save reward error:', e);
        alert('Network error');
    }
}

// ─── FAN ANALYTICS ───────────────────────────────────────────────────
async function loadFanAnalytics() {
    const tierEl = document.getElementById('fanTierDistribution');
    const topEl = document.getElementById('fanTopContributors');
    if (!tierEl || !topEl) return;
    try {
        const res = await fetch('/api/admin/fan-analytics', { credentials: 'same-origin' });
        if (handleAuthExpired(res)) return;
        if (!res.ok) {
            tierEl.innerHTML = '<div style="color:#ef4444;">Failed to load</div>';
            topEl.innerHTML = '<div style="color:#ef4444;">Failed to load</div>';
            return;
        }
        const data = await res.json();
        renderTierDistribution(data.tierDistribution || []);
        renderTopContributors(data.topFans || []);
    } catch (e) {
        console.error('Fan analytics error:', e);
    }
}

function renderTierDistribution(data) {
    const el = document.getElementById('fanTierDistribution');
    if (!el) return;
    if (!data.length) {
        el.innerHTML = '<div style="color:#666;">No tier data yet</div>';
        return;
    }
    const total = data.reduce((s, t) => s + (t.count || 0), 0) || 1;
    el.innerHTML = data.map(t => {
        const pct = ((t.count || 0) / total * 100).toFixed(1);
        return `
            <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span>${escapeHtml(t.current_tier || 'unranked')}</span>
                    <span class="text-muted">${(t.count || 0).toLocaleString()} (${pct}%)</span>
                </div>
                <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:var(--accent, #A2812E);"></div>
                </div>
            </div>`;
    }).join('');
}

function renderTopContributors(data) {
    const el = document.getElementById('fanTopContributors');
    if (!el) return;
    if (!data.length) {
        el.innerHTML = '<div style="color:#666;">No contributors yet</div>';
        return;
    }
    el.innerHTML = data.slice(0, 8).map((f, i) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span><strong style="color:var(--text-muted);margin-right:8px;">#${i + 1}</strong>${escapeHtml(f.name || f.email || 'Unknown')}</span>
            <span style="color:var(--accent);font-weight:600;">${(f.total_score || 0).toLocaleString()}</span>
        </div>
    `).join('');
}

// ─── LEADERBOARD REFRESH ─────────────────────────────────────────────
async function refreshLeaderboard() {
    const btn = document.getElementById('refreshLeaderboardBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
        const res = await fetch('/api/admin/leaderboard/refresh', {
            method: 'POST', credentials: 'same-origin'
        });
        if (handleAuthExpired(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || 'Failed to refresh leaderboard');
            return;
        }
        showSuccessModal('Leaderboard Refreshed', 'Rankings updated');
        loadLeaderboard();
    } catch (e) {
        console.error('Refresh leaderboard error:', e);
        alert('Network error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

// ─── EVENT WIRING (Tier 1) ───────────────────────────────────────────
document.getElementById('newTaskBtn')?.addEventListener('click', showCreateTaskModal);
document.getElementById('newMultiplierBtn')?.addEventListener('click', showCreateMultiplierModal);
document.getElementById('newRewardBtn')?.addEventListener('click', showCreateRewardModal);
document.getElementById('closeTaskModalBtn')?.addEventListener('click', closeTaskModal);
document.getElementById('closeMultiplierModalBtn')?.addEventListener('click', closeMultiplierModal);
document.getElementById('closeRewardModalBtn')?.addEventListener('click', closeRewardModal);
document.getElementById('taskForm')?.addEventListener('submit', submitTaskForm);
document.getElementById('multiplierForm')?.addEventListener('submit', submitMultiplierForm);
document.getElementById('rewardForm')?.addEventListener('submit', submitRewardForm);
document.getElementById('applyTaskFiltersBtn')?.addEventListener('click', loadTasks);
document.getElementById('refreshLeaderboardBtn')?.addEventListener('click', refreshLeaderboard);

// Tasks sub-tab switcher
document.querySelectorAll('[data-tasks-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTasksTab(btn.dataset.tasksTab));
});

