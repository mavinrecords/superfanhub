/**
 * Gift Card Auto-Apply SDK
 * Drop-in script for e-commerce integration
 */

(function (window) {
    'use strict';

    const SDK_VERSION = '1.0.0';
    const API_BASE = window.GiftCardConfig?.apiBase || '';

    class GiftCardSDK {
        constructor(config = {}) {
            this.config = {
                inputSelector: config.inputSelector || '#gift-card-code',
                ...config
            };

            this.init();
        }

        init() {
            // Check for saved card in URL
            const urlParams = new URLSearchParams(window.location.search);
            const codeFromUrl = urlParams.get('code');
            const shareToken = urlParams.get('share');

            if (codeFromUrl) {
                this.saveCard(codeFromUrl);
            }

            // Check for saved card
            const savedCode = this.getSavedCard();
            if (savedCode) {
                this.autoFill(savedCode);
            }

            // Listen for input changes to save card
            this.attachListeners();
        }

        saveCard(code) {
            try {
                localStorage.setItem('gc_code', code);
                localStorage.setItem('gc_saved_at', Date.now());
            } catch (e) {
                console.warn('GiftCardSDK: Failed to save card', e);
            }
        }

        getSavedCard() {
            try {
                const code = localStorage.getItem('gc_code');
                const savedAt = localStorage.getItem('gc_saved_at');

                // Expire after 24 hours
                if (code && savedAt && Date.now() - parseInt(savedAt) < 24 * 60 * 60 * 1000) {
                    return code;
                }
                return null;
            } catch (e) {
                return null;
            }
        }

        autoFill(code) {
            const input = document.querySelector(this.config.inputSelector);
            if (input) {
                input.value = code;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                // Optional: Trigger validation
                if (this.config.autoSubmit) {
                    const form = input.closest('form');
                    if (form) form.requestSubmit();
                }

                console.log('GiftCardSDK: Auto-filled card code');
            }
        }

        attachListeners() {
            const input = document.querySelector(this.config.inputSelector);
            if (input) {
                input.addEventListener('change', (e) => {
                    if (e.target.value.length >= 8) {
                        this.saveCard(e.target.value);
                    }
                });
            }
        }

        async validate(code) {
            try {
                const response = await fetch(`${API_BASE}/api/cards/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                return await response.json();
            } catch (error) {
                console.error('GiftCardSDK: Validation failed', error);
                throw error;
            }
        }
    }

    // Expose global
    window.GiftCardSDK = GiftCardSDK;

    // Auto-init if configured
    if (window.GiftCardConfig?.autoInit) {
        new GiftCardSDK(window.GiftCardConfig);
    }

})(window);
