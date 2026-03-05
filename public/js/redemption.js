// Gift Card Redemption - Frontend Logic

let currentCard = null;

// =============================================================
// INITIALIZATION - Ensure proper initial state
// =============================================================
document.addEventListener('DOMContentLoaded', function () {
    // Ensure result sections are hidden on page load
    document.getElementById('cardResult')?.classList.add('hidden');
    document.getElementById('redeemSection')?.classList.add('hidden');
    document.getElementById('discountSection')?.classList.add('hidden');
    document.getElementById('historySection')?.classList.add('hidden');
    document.getElementById('validateForm')?.classList.remove('hidden');
});

// =============================================================
// TOAST NOTIFICATION SYSTEM
// =============================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

    toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Close">×</button>
  `;

    container.appendChild(toast);

    // Auto dismiss
    const timeout = setTimeout(() => dismissToast(toast), 4000);

    // Manual dismiss
    toast.querySelector('.toast-close').addEventListener('click', () => {
        clearTimeout(timeout);
        dismissToast(toast);
    });
}

function dismissToast(toast) {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
}

// =============================================================
// STATUS BANNER (UI Contract Component #3)
// =============================================================
function showStatusBanner(message, type = 'error') {
    const banner = document.getElementById('statusBanner');
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

    banner.className = `status-banner status-banner--${type}`;
    banner.innerHTML = `
        <span class="status-banner-icon">${icons[type] || icons.info}</span>
        <span class="status-banner-content">${message}</span>
    `;
    banner.classList.remove('hidden');
}

function hideStatusBanner() {
    const banner = document.getElementById('statusBanner');
    banner.classList.add('hidden');
}

// =============================================================
// BUTTON LOADING STATES
// =============================================================
function setButtonLoading(btn, loading, loadingText = null) {
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
        if (loadingText) btn.dataset.originalText = btn.textContent;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        if (btn.dataset.originalText) {
            // Restore happens elsewhere based on state
        }
    }
}

// Update Apply button text based on code completeness
function updateApplyButtonState() {
    const btn = document.getElementById('validateBtn');
    const code = getFullCode().replace(/-/g, '');
    // Always enabled - validation happens on submit with helpful feedback
    btn.disabled = false;

    if (code.length === 16) {
        btn.textContent = 'Apply Card';
    } else if (code.length > 0) {
        btn.textContent = `Apply Card (${code.length}/16)`;
    } else {
        btn.textContent = 'Apply Card';
    }
}

// =============================================================
// CODE INPUT - SEGMENTED WITH AUTO-ADVANCE
// =============================================================
const codeInputs = [
    document.getElementById('code1'),
    document.getElementById('code2'),
    document.getElementById('code3'),
    document.getElementById('code4')
];

// Auto-advance and backspace handling
codeInputs.forEach((input, index) => {
    // Input event - auto advance
    input.addEventListener('input', (e) => {
        const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        e.target.value = value;

        // Update filled state
        if (value.length === 4) {
            input.classList.add('filled');
            // Auto advance to next
            if (index < 3) {
                codeInputs[index + 1].focus();
            }
        } else {
            input.classList.remove('filled');
        }

        // Update Apply button state and hide any previous error
        updateApplyButtonState();
        hideStatusBanner();
    });

    // Keydown for backspace navigation
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
            codeInputs[index - 1].focus();
        }
        // Arrow key navigation
        if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && index > 0) {
            e.preventDefault();
            codeInputs[index - 1].focus();
        }
        if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length && index < 3) {
            e.preventDefault();
            codeInputs[index + 1].focus();
        }
    });

    // Remove error state on focus
    input.addEventListener('focus', () => {
        input.classList.remove('error');
    });
});

// Paste handling - split code across segments
codeInputs[0].addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');

    if (pasted.length >= 16) {
        // Full code pasted
        for (let i = 0; i < 4; i++) {
            codeInputs[i].value = pasted.substr(i * 4, 4);
            codeInputs[i].classList.add('filled');
        }
        codeInputs[3].focus();
    } else {
        // Partial paste
        codeInputs[0].value = pasted.substr(0, 4);
        if (pasted.length === 4) {
            codeInputs[0].classList.add('filled');
            codeInputs[1].focus();
        }
    }
});

// Get full code from segments
function getFullCode() {
    return codeInputs.map(i => i.value.toUpperCase()).join('-');
}

// Clear all code inputs
function clearCodeInputs() {
    codeInputs.forEach(input => {
        input.value = '';
        input.classList.remove('filled', 'error');
    });
    codeInputs[0].focus();
}

// Show error on code inputs
function showCodeError() {
    codeInputs.forEach(input => input.classList.add('error'));
}

// =============================================================
// CARD VALIDATION
// =============================================================
document.getElementById('validateForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const code = getFullCode();
    const codeLength = code.replace(/-/g, '').length;

    if (codeLength === 0) {
        showStatusBanner('Please enter your 16-digit gift card code to continue.', 'info');
        codeInputs[0].focus();
        return;
    }

    if (codeLength < 16) {
        showStatusBanner(`Please enter all ${16 - codeLength} remaining digits.`, 'warning');
        showCodeError();
        return;
    }

    hideStatusBanner();

    const btn = document.getElementById('validateBtn');
    setButtonLoading(btn, true);

    try {
        const response = await fetch('/api/cards/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        const data = await response.json();

        if (!response.ok) {
            // Map error codes to UI contract copy
            let errorMsg = 'This code doesn\'t exist. Check and try again.';
            if (data.error?.includes('expired')) {
                errorMsg = `This card expired on ${data.expiryDate || 'a previous date'}.`;
            } else if (data.error?.includes('redeemed') || data.error?.includes('exhausted')) {
                errorMsg = 'This card has already been fully used.';
            } else if (data.error?.includes('revoked')) {
                errorMsg = 'This card is no longer valid.';
            } else if (data.error?.includes('frozen')) {
                errorMsg = 'This card is temporarily frozen.';
            }
            showStatusBanner(errorMsg, 'error');
            showCodeError();
            return;
        }

        currentCard = { ...data.card, code };
        displayCard(data.card);
        showToast(`$${data.card.currentBalance?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'} available`, 'success');

    } catch (error) {
        showStatusBanner('Something went wrong. Try again.', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
});

// =============================================================
// DISPLAY CARD RESULT
// =============================================================
function displayCard(card) {
    const resultSection = document.getElementById('cardResult');
    const validateForm = document.getElementById('validateForm');

    // Hide form, show result
    validateForm.classList.add('hidden');
    resultSection.classList.remove('hidden');

    // Update tier
    document.getElementById('cardTier').textContent = (card.tier || 'standard').toUpperCase();

    // Update value/discount display based on card type
    const valueSection = document.getElementById('cardValueSection');
    const discountSection = document.getElementById('cardDiscountSection');
    const primaryBtn = document.getElementById('primaryActionBtn');
    const secondaryAction = document.getElementById('secondaryAction');
    const secondaryBtn = document.getElementById('secondaryActionBtn');

    // Debug: log card data received
    console.log('displayCard received:', card);

    if (card.cardType === 'value') {
        valueSection.classList.remove('hidden');
        discountSection.classList.add('hidden');
        const balance = card.currentBalance || 0;
        document.getElementById('cardBalance').textContent = `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // UI Contract copy: "Apply $XX.XX to Cart"
        primaryBtn.textContent = `Apply $${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to Cart`;
        primaryBtn.onclick = showRedeemSection;
        secondaryAction.classList.add('hidden');

    } else if (card.cardType === 'discount') {
        valueSection.classList.add('hidden');
        discountSection.classList.remove('hidden');
        document.getElementById('cardDiscount').textContent = `${card.discountPercent}% OFF`;
        document.getElementById('cardUses').textContent = card.discountUsesRemaining
            ? `${card.discountUsesRemaining} uses remaining`
            : 'Unlimited uses';

        primaryBtn.textContent = 'Apply to Ticket';
        primaryBtn.onclick = showDiscountSection;
        secondaryAction.classList.add('hidden');

    } else {
        // Hybrid
        valueSection.classList.remove('hidden');
        discountSection.classList.remove('hidden');
        const balance = card.currentBalance || 0;
        document.getElementById('cardBalance').textContent = `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('cardDiscount').textContent = `+ ${card.discountPercent}% OFF`;
        document.getElementById('cardUses').textContent = card.discountUsesRemaining
            ? `${card.discountUsesRemaining} uses remaining`
            : 'Unlimited uses';

        primaryBtn.textContent = 'Redeem Value';
        primaryBtn.onclick = showRedeemSection;
        secondaryAction.classList.remove('hidden');
        secondaryBtn.textContent = 'Or apply discount instead →';
        secondaryBtn.onclick = showDiscountSection;
    }

    // Mask code display
    const displayCode = currentCard.code.replace(/(.{4})(.{8})(.{4})/, '$1-••••-••••-$3');
    document.getElementById('cardCodeDisplay').textContent = displayCode;

    // Expiry
    const expiryEl = document.getElementById('cardExpiry');
    if (card.expiresAt) {
        const expDate = new Date(card.expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

        if (daysLeft <= 7) {
            expiryEl.textContent = `⚠ Expires in ${daysLeft} days`;
            expiryEl.classList.add('warning');
        } else {
            expiryEl.textContent = `Expires ${expDate.toLocaleDateString()}`;
            expiryEl.classList.remove('warning');
        }
        expiryEl.classList.remove('hidden');
    } else {
        expiryEl.textContent = '';
        expiryEl.classList.add('hidden');
    }

    // Trigger tier reveal animation
    triggerTierReveal();

    // Load activity history (includes state and expiry display)
    if (currentCard && currentCard.code) {
        loadHistory(currentCard.code);
    }
}

// =============================================================
// REDEEM VALUE
// =============================================================
function showRedeemSection() {
    document.getElementById('cardResult').classList.add('hidden');
    document.getElementById('redeemSection').classList.remove('hidden');
    document.getElementById('redeemAmount').focus();
    document.getElementById('redeemAmount').max = currentCard.currentBalance;
}

document.getElementById('cancelRedeem')?.addEventListener('click', () => {
    document.getElementById('redeemSection').classList.add('hidden');
    document.getElementById('cardResult').classList.remove('hidden');
});

document.getElementById('redeemForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('redeemAmount').value);
    if (isNaN(amount) || amount <= 0) {
        showToast('Enter a valid amount.', 'error');
        return;
    }

    if (amount > currentCard.currentBalance) {
        // UI Contract: Insufficient balance messaging
        const remaining = amount - currentCard.currentBalance;
        showToast(`This card has $${currentCard.currentBalance.toFixed(2)}. Remaining $${remaining.toFixed(2)} due at checkout.`, 'error');
        return;
    }

    const btn = document.getElementById('confirmRedeem');
    setButtonLoading(btn, true);

    try {
        const response = await fetch('/api/cards/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: currentCard.code, amount })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Redemption failed', 'error');
            return;
        }

        // UI Contract: "$XX.XX applied to your order"
        showToast(`$${amount.toFixed(2)} applied to your order`, 'success');

        // Update card data and display
        currentCard.currentBalance = data.newBalance;
        document.getElementById('cardBalance').textContent = `$${data.newBalance.toFixed(2)}`;

        // Return to card view
        document.getElementById('redeemSection').classList.add('hidden');
        document.getElementById('cardResult').classList.remove('hidden');
        document.getElementById('redeemAmount').value = '';

    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
});

// =============================================================
// APPLY DISCOUNT
// =============================================================
function showDiscountSection() {
    document.getElementById('cardResult').classList.add('hidden');
    document.getElementById('discountSection').classList.remove('hidden');
    document.getElementById('ticketAmount').focus();
}

document.getElementById('cancelDiscount')?.addEventListener('click', () => {
    document.getElementById('discountSection').classList.add('hidden');
    document.getElementById('cardResult').classList.remove('hidden');
});

// Live discount preview
document.getElementById('ticketAmount')?.addEventListener('input', (e) => {
    const amount = parseFloat(e.target.value);
    const preview = document.getElementById('discountPreview');
    const previewText = document.getElementById('discountPreviewText');

    if (!isNaN(amount) && amount > 0 && currentCard) {
        const discount = amount * (currentCard.discountPercent / 100);
        const final = amount - discount;
        previewText.textContent = `You save $${discount.toFixed(2)}! Final price: $${final.toFixed(2)}`;
        preview.classList.remove('hidden');
    } else {
        preview.classList.add('hidden');
    }
});

document.getElementById('discountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ticketAmount = parseFloat(document.getElementById('ticketAmount').value);
    const ticketId = document.getElementById('ticketId').value.trim();

    if (isNaN(ticketAmount) || ticketAmount <= 0) {
        showToast('Please enter a valid ticket amount', 'error');
        return;
    }

    if (!ticketId) {
        showToast('Please enter a ticket/order ID', 'error');
        return;
    }

    const btn = document.getElementById('confirmDiscount');
    setButtonLoading(btn, true);

    try {
        const response = await fetch('/api/cards/apply-discount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: currentCard.code,
                ticketAmount,
                ticketId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to apply discount', 'error');
            return;
        }

        showToast(`Discount applied! You saved $${data.discountApplied.toFixed(2)}`, 'success');

        // Update uses remaining if applicable
        if (data.usesRemaining !== undefined) {
            currentCard.discountUsesRemaining = data.usesRemaining;
            document.getElementById('cardUses').textContent = data.usesRemaining
                ? `${data.usesRemaining} uses remaining`
                : 'Unlimited uses';
        }

        // Return to card view
        document.getElementById('discountSection').classList.add('hidden');
        document.getElementById('cardResult').classList.remove('hidden');
        document.getElementById('ticketAmount').value = '';
        document.getElementById('ticketId').value = '';
        document.getElementById('discountPreview').classList.add('hidden');

    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
});

// =============================================================
// RESET / NEW CARD
// =============================================================
function resetToStart() {
    currentCard = null;
    document.getElementById('validateForm').classList.remove('hidden');
    document.getElementById('cardResult').classList.add('hidden');
    document.getElementById('redeemSection').classList.add('hidden');
    document.getElementById('discountSection').classList.add('hidden');
    clearCodeInputs();
}

// Add keyboard shortcut: Escape to go back
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!document.getElementById('redeemSection').classList.contains('hidden')) {
            document.getElementById('cancelRedeem').click();
        } else if (!document.getElementById('discountSection').classList.contains('hidden')) {
            document.getElementById('cancelDiscount').click();
        }
    }
});

// =============================================================
// CARD STATE DISPLAY
// =============================================================
const STATE_CONFIG = {
    active: {
        label: 'Active',
        explanation: 'This card is ready to use.',
        class: 'status-active'
    },
    partial: {
        label: 'Partially Used',
        explanation: 'Some value has been redeemed. The remaining balance is shown above.',
        class: 'status-partial'
    },
    exhausted: {
        label: 'Fully Redeemed',
        explanation: 'This card has been fully used. Thank you for being a superfan!',
        class: 'status-exhausted'
    },
    expired: {
        label: 'Expired',
        explanation: 'This card is no longer valid. It expired on the date shown.',
        class: 'status-expired'
    },
    revoked: {
        label: 'Revoked',
        explanation: 'This card is no longer valid. Please contact support if you have questions.',
        class: 'status-revoked'
    }
};

function getCardState(card) {
    // Check expiry first
    if (card.expiresAt) {
        const now = new Date();
        const expDate = new Date(card.expiresAt);
        if (expDate < now) return 'expired';
    }

    // Check status
    if (card.status === 'revoked') return 'revoked';
    if (card.status === 'exhausted') return 'exhausted';

    // Check if partially used
    if (card.cardType === 'value' || card.cardType === 'hybrid') {
        if (card.currentBalance < card.initialValue && card.currentBalance > 0) {
            return 'partial';
        }
        if (card.currentBalance <= 0 && card.discountPercent <= 0) {
            return 'exhausted';
        }
    }

    return 'active';
}

function displayCardState(card) {
    const state = getCardState(card);
    const config = STATE_CONFIG[state] || STATE_CONFIG.active;

    const labelEl = document.getElementById('statusLabel');
    const explanationEl = document.getElementById('statusExplanation');

    labelEl.textContent = config.label;
    labelEl.className = `status-label ${config.class}`;
    explanationEl.textContent = config.explanation;
}

// =============================================================
// EXPIRY WARNING DISPLAY
// =============================================================
function displayExpiryWarning(card) {
    const warningEl = document.getElementById('expiryWarning');
    const textEl = document.getElementById('expiryText');

    if (!card.expiresAt) {
        warningEl.classList.add('hidden');
        return;
    }

    const now = new Date();
    const expDate = new Date(card.expiresAt);
    const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

    warningEl.classList.remove('hidden', 'warning-normal', 'warning-urgent', 'warning-expired');

    if (daysLeft <= 0) {
        textEl.textContent = `This card expired on ${expDate.toLocaleDateString()}`;
        warningEl.classList.add('warning-expired');
    } else if (daysLeft <= 14) {
        textEl.textContent = `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — use it soon!`;
        warningEl.classList.add('warning-urgent');
    } else {
        textEl.textContent = `Expires on ${expDate.toLocaleDateString()}`;
        warningEl.classList.add('warning-normal');
    }
}

// =============================================================
// REDEMPTION HISTORY
// =============================================================
async function loadHistory(code) {
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyHistory');

    historySection.classList.remove('hidden');
    historyList.innerHTML = '<div class="text-center text-muted">Loading activity...</div>';

    try {
        const response = await fetch('/api/cards/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        if (!response.ok) {
            historyList.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        const data = await response.json();

        // Update card state and expiry from fresh data
        if (data.card) {
            displayCardState(data.card);
            displayExpiryWarning(data.card);
        }

        if (!data.transactions || data.transactions.length === 0) {
            historyList.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        historyList.innerHTML = data.transactions.map(t => renderHistoryItem(t)).join('');

    } catch (error) {
        historyList.innerHTML = '';
        emptyState.classList.remove('hidden');
    }
}

function renderHistoryItem(transaction) {
    const date = new Date(transaction.performedAt);
    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });

    let amountText, contextText;

    if (transaction.type === 'redeem') {
        amountText = `$${transaction.amount?.toFixed(2) || '0.00'} redeemed`;
        contextText = transaction.notes || 'Value redemption';
    } else if (transaction.type === 'discount_apply') {
        amountText = `${transaction.discountApplied ? '$' + transaction.discountApplied.toFixed(2) : ''} discount applied`;
        contextText = transaction.ticketId
            ? `Saved on ticket ${transaction.ticketId}`
            : 'Discount applied';
    } else {
        amountText = 'Activity';
        contextText = transaction.notes || '';
    }

    return `
        <div class="history-item">
            <div class="history-item-header">
                <span class="history-item-amount">${amountText}</span>
                <span class="history-item-date">${formattedDate}</span>
            </div>
            <div class="history-item-context">${contextText}</div>
        </div>
    `;
}

// =============================================================
// TIER REVEAL ANIMATION
// =============================================================
function triggerTierReveal() {
    const cardDisplay = document.getElementById('giftCardDisplay');
    if (cardDisplay) {
        cardDisplay.classList.add('tier-reveal');
        // Remove class after animation completes
        setTimeout(() => {
            cardDisplay.classList.remove('tier-reveal');
        }, 400);
    }
}

// =============================================================
// WALLET INTEGRATION
// =============================================================
function showWalletButtons(card) {
    const section = document.getElementById('walletSection');
    if (!section) return;

    section.classList.remove('hidden');

    document.getElementById('addToApplyWallet').onclick = () => {
        window.open(`/api/cards/wallet/pass/apple?code=${card.code}`, '_blank');
    };

    document.getElementById('addToGoogleWallet').onclick = () => {
        // For Google, we typically receive a JWT or specific URL. 
        // Our mock endpoint returns JSON object, so let's just log or alert for now 
        // as we can't fully render the "Add to Google Pay" button without their JS library.
        // We'll simulate the download/action.
        window.open(`/api/cards/wallet/pass/google?code=${card.code}`, '_blank');
    };
}

// Hook into displayCard to show wallet section
const originalDisplayCard = displayCard;
displayCard = function (card) {
    originalDisplayCard(card);
    showWalletButtons(card);
};

// =============================================================
// LOYALTY CHECK
// =============================================================
document.getElementById('toggleLoyaltyBtn')?.addEventListener('click', (e) => {
    const section = document.getElementById('loyaltySection');
    section.classList.toggle('hidden');
    e.target.style.display = 'none';
});

document.getElementById('loyaltyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loyaltyEmail').value;
    const resultDiv = document.getElementById('loyaltyResult');

    if (!email) return;

    try {
        // Fetch profile
        const profileResponse = await fetch(`/api/loyalty/profile/${email}`);
        const profileData = await profileResponse.json();

        // Fetch referral
        const refResponse = await fetch(`/api/loyalty/referral/${email}`);
        const refData = await refResponse.json();

        if (profileData.error || refData.error) {
            showToast('Could not load loyalty info', 'error');
            return;
        }

        document.getElementById('loyaltyPoints').textContent = profileData.points;
        document.getElementById('loyaltyTier').textContent = (profileData.tier || 'BRONZE').toUpperCase();
        document.getElementById('loyaltyRefCode').textContent = refData.code || 'Generating...';

        resultDiv.classList.remove('hidden');

    } catch (error) {
        console.error('Loyalty error:', error);
        showToast('Network error', 'error');
    }
});
