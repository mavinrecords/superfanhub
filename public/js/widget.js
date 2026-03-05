/**
 * Gift Card Balance Checker Widget
 * Embeddable widget for checking card balance
 * Usage: <div id="gc-balance-widget"></div><script src="/js/widget.js"></script>
 */

(function (window, document) {
    'use strict';

    // Config
    const CONTAINER_ID = 'gc-balance-widget';
    const API_BASE = window.GiftCardConfig?.apiBase || '';

    // CSS
    const STYLES = `
        .gc-widget {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 300px;
            padding: 20px;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            border: 1px solid #e5e7eb;
        }
        .gc-widget.dark {
            background: #1f2937;
            border-color: #374151;
            color: #fff;
        }
        .gc-title {
            font-size: 1.125rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: inherit;
        }
        .gc-input-group {
            margin-bottom: 1rem;
        }
        .gc-input {
            width: 100%;
            padding: 0.5rem 0.75rem;
            border-radius: 0.375rem;
            border: 1px solid #d1d5db;
            font-size: 0.875rem;
            box-sizing: border-box;
        }
        .gc-btn {
            width: 100%;
            padding: 0.5rem 1rem;
            background-color: #10b981;
            color: white;
            border: none;
            border-radius: 0.375rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .gc-btn:hover {
            background-color: #059669;
        }
        .gc-btn:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }
        .gc-result {
            margin-top: 1rem;
            padding: 0.75rem;
            border-radius: 0.375rem;
            background-color: #f3f4f6;
            text-align: center;
            display: none;
        }
        .gc-result.success {
            background-color: #ecfdf5;
            color: #065f46;
            border: 1px solid #a7f3d0;
        }
        .gc-result.error {
            background-color: #fef2f2;
            color: #991b1b;
            border: 1px solid #fecaca;
        }
        .gc-balance {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0.25rem 0;
        }
        .gc-loader {
            display: inline-block;
            width: 1rem;
            height: 1rem;
            border: 2px solid #ffffff;
            border-radius: 50%;
            border-top-color: transparent;
            animation: gc-spin 1s linear infinite;
        }
        @keyframes gc-spin {
            to { transform: rotate(360deg); }
        }
    `;

    class BalanceWidget {
        constructor() {
            this.container = document.getElementById(CONTAINER_ID);
            if (!this.container) return;

            this.init();
        }

        init() {
            // Inject styles
            const style = document.createElement('style');
            style.textContent = STYLES;
            document.head.appendChild(style);

            // Render UI
            this.container.innerHTML = `
                <div class="gc-widget ${this.container.dataset.theme || 'light'}">
                    <div class="gc-title">Check Card Balance</div>
                    <div class="gc-input-group">
                        <input type="text" class="gc-input" placeholder="Enter card code (e.g. ABCD-1234)" maxlength="19">
                    </div>
                    <button class="gc-btn">Check Balance</button>
                    <div class="gc-result"></div>
                </div>
            `;

            // Bind events
            this.input = this.container.querySelector('.gc-input');
            this.button = this.container.querySelector('.gc-btn');
            this.result = this.container.querySelector('.gc-result');

            this.button.addEventListener('click', () => this.checkBalance());
            this.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.checkBalance();
            });

            // Format input
            this.input.addEventListener('input', (e) => {
                let value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                if (value.length > 4) value = value.match(/.{1,4}/g)?.join('-') || value;
                e.target.value = value;
            });
        }

        async checkBalance() {
            const code = this.input.value.replace(/-/g, '');
            if (code.length < 8) return;

            this.setLoading(true);

            try {
                const response = await fetch(`${API_BASE}/api/cards/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });

                const data = await response.json();

                if (data.valid) {
                    this.showResult('success', `
                        <div>Balance Available</div>
                        <div class="gc-balance">$${data.card.currentBalance.toFixed(2)}</div>
                        <div style="font-size: 0.8em">${data.card.tier} Tier</div>
                    `);
                } else {
                    this.showResult('error', data.error || 'Invalid card code');
                }
            } catch (error) {
                this.showResult('error', 'Failed to check balance');
            } finally {
                this.setLoading(false);
            }
        }

        setLoading(loading) {
            this.button.disabled = loading;
            this.button.innerHTML = loading ? '<span class="gc-loader"></span>' : 'Check Balance';
        }

        showResult(type, html) {
            this.result.className = `gc-result ${type}`;
            this.result.innerHTML = html;
            this.result.style.display = 'block';
        }
    }

    // Init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new BalanceWidget());
    } else {
        new BalanceWidget();
    }

})(window, document);
