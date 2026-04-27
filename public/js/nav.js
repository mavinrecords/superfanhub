/**
 * public/js/nav.js — Mavin SuperFan Hub mobile navigation drawer
 *
 * Single primitive used by both fan pages and admin. Auto-initialises on
 * DOMContentLoaded by attaching a click handler to every element matching
 * `.drawer-toggle` or `[data-drawer-toggle]`. Drawer styles live in
 * /css/mobile.css and the trigger is shown only at the appropriate
 * breakpoint via .drawer-toggle--fan / .drawer-toggle--admin.
 *
 * Markup contract (toggle button):
 *   <button class="drawer-toggle drawer-toggle--fan tap-44"
 *           data-drawer-source="#nav"
 *           data-drawer-title="Menu"
 *           aria-label="Open menu">
 *     <svg ...></svg>
 *   </button>
 *
 * Optional data-attributes on the toggle:
 *   data-drawer-source   CSS selector for the nav element to mirror.
 *                        Defaults to "#nav, .nav, .sidebar, [data-drawer-nav]".
 *   data-drawer-title    Text for the drawer header (default: "Menu").
 *
 * Behaviour:
 *   - Right-side slide-in via .drawer.is-open (CSS owns the transform).
 *   - Focus trap while the drawer is open, with Tab cycling.
 *   - Escape closes the drawer.
 *   - Overlay click closes the drawer.
 *   - Body scroll lock via .drawer-open class (mobile.css).
 *   - aria-expanded is mirrored on the toggle button.
 *   - M3-4: swipe-right on the drawer closes it once the swipe passes 40 % of
 *     the drawer width. Disabled when prefers-reduced-motion is set.
 *
 * Programmatic API:
 *   window.MavinDrawer.open()    — open the first registered toggle's drawer
 *   window.MavinDrawer.close()
 *   window.MavinDrawer.toggle()
 *   window.MavinDrawer.isOpen()  — boolean
 */
(function () {
    'use strict';

    let activeDrawer = null;
    let activeToggle = null;
    let overlay = null;
    let lastFocusedElement = null;

    const prefersReducedMotion =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ----- Setup helpers ------------------------------------------------------

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.querySelector('.drawer-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'drawer-overlay';
            overlay.setAttribute('hidden', '');
            document.body.appendChild(overlay);
        }
        overlay.addEventListener('click', closeDrawer);
        return overlay;
    }

    function buildDrawer(toggle) {
        let drawer = document.querySelector('.drawer');
        if (drawer) return drawer;

        drawer = document.createElement('aside');
        drawer.className = 'drawer';
        drawer.id = 'drawer';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.setAttribute('aria-label', toggle.dataset.drawerTitle || 'Site menu');

        const header = document.createElement('div');
        header.className = 'drawer-header';

        const title = document.createElement('div');
        title.className = 'drawer-title';
        title.textContent = toggle.dataset.drawerTitle || 'Menu';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'drawer-close tap-44';
        closeBtn.setAttribute('aria-label', 'Close menu');
        closeBtn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.addEventListener('click', closeDrawer);

        header.appendChild(title);
        header.appendChild(closeBtn);

        const nav = document.createElement('nav');
        nav.className = 'drawer-nav';
        nav.setAttribute('aria-label', 'Site navigation');

        const sourceSel =
            toggle.dataset.drawerSource ||
            '#nav, .nav, .sidebar, [data-drawer-nav], .topbar-nav';
        const source = document.querySelector(sourceSel);
        if (source) {
            const links = source.querySelectorAll(
                'a, [data-page], [data-nav-link], button[data-page], button[data-action]'
            );
            const seen = new Set();
            links.forEach((link) => {
                // De-dupe by visible label so we don't clone the same item twice
                // (e.g. when sidebar nav is duplicated for desktop+mobile).
                const key = (link.getAttribute('href') || '') + '|' +
                    (link.textContent || '').trim().toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);

                const clone = link.cloneNode(true);
                // CSP safety: strip any inline onclick/onkeyup from the clone.
                clone.removeAttribute('onclick');
                clone.removeAttribute('onkeyup');
                clone.removeAttribute('onkeydown');
                // Mark active link based on current pathname.
                if (clone.tagName === 'A' && clone.pathname &&
                    clone.pathname === window.location.pathname) {
                    clone.classList.add('is-active');
                    clone.setAttribute('aria-current', 'page');
                }
                // Non-interactive elements (DIVs used as nav items) need to be
                // keyboard-reachable inside the drawer.
                if (clone.tagName !== 'A' && clone.tagName !== 'BUTTON') {
                    if (!clone.hasAttribute('tabindex')) clone.setAttribute('tabindex', '0');
                    if (!clone.hasAttribute('role')) clone.setAttribute('role', 'link');
                    // Allow Enter / Space to activate.
                    clone.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            clone.click();
                        }
                    });
                }
                // Make sure activating a clone closes the drawer too.
                clone.addEventListener('click', () => {
                    // Defer close so the original target's nav handler runs first.
                    setTimeout(closeDrawer, 0);
                });
                nav.appendChild(clone);
            });
        }

        drawer.appendChild(header);
        drawer.appendChild(nav);
        document.body.appendChild(drawer);
        return drawer;
    }

    function getFocusable(scope) {
        return Array.from(
            scope.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        ).filter((el) => !el.hasAttribute('hidden'));
    }

    function trapFocus(e) {
        if (!activeDrawer || e.key !== 'Tab') return;
        const focusable = getFocusable(activeDrawer);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function onKeyDown(e) {
        if (!activeDrawer) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeDrawer();
        } else if (e.key === 'Tab') {
            trapFocus(e);
        }
    }

    // ----- Open / Close -------------------------------------------------------

    function openDrawer(toggle) {
        if (activeDrawer) return;
        activeToggle = toggle;
        activeDrawer = buildDrawer(toggle);
        ensureOverlay();
        lastFocusedElement = document.activeElement;

        activeDrawer.classList.add('is-open');
        activeDrawer.setAttribute('aria-hidden', 'false');
        overlay.removeAttribute('hidden');
        overlay.classList.add('is-open');
        document.body.classList.add('drawer-open');
        if (activeToggle) activeToggle.setAttribute('aria-expanded', 'true');

        const focusable = getFocusable(activeDrawer);
        if (focusable.length) focusable[0].focus();

        document.addEventListener('keydown', onKeyDown);
        if (!prefersReducedMotion) initSwipeToClose();
    }

    function closeDrawer() {
        if (!activeDrawer) return;
        activeDrawer.classList.remove('is-open');
        activeDrawer.setAttribute('aria-hidden', 'true');
        if (overlay) {
            overlay.classList.remove('is-open');
            overlay.setAttribute('hidden', '');
        }
        document.body.classList.remove('drawer-open');
        if (activeToggle) activeToggle.setAttribute('aria-expanded', 'false');
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
        document.removeEventListener('keydown', onKeyDown);
        teardownSwipeToClose();
        activeDrawer = null;
        activeToggle = null;
        lastFocusedElement = null;
    }

    function toggleDrawer(toggle) {
        if (activeDrawer) closeDrawer();
        else openDrawer(toggle);
    }

    // ----- M3-4: swipe-to-close ----------------------------------------------

    let swipeStart = null;
    let swipeDelta = 0;

    function onSwipeStart(e) {
        if (!activeDrawer) return;
        const point = e.touches ? e.touches[0] : e;
        swipeStart = point.clientX;
        swipeDelta = 0;
    }

    function onSwipeMove(e) {
        if (swipeStart == null || !activeDrawer) return;
        const point = e.touches ? e.touches[0] : e;
        swipeDelta = point.clientX - swipeStart;
        if (swipeDelta > 0) {
            // Drawer is on the right; right-swipe closes.
            activeDrawer.style.transform = 'translateX(' + swipeDelta + 'px)';
        }
    }

    function onSwipeEnd() {
        if (swipeStart == null || !activeDrawer) return;
        const w = activeDrawer.offsetWidth || 1;
        // Reset inline transform so CSS class governs again.
        activeDrawer.style.transform = '';
        if (swipeDelta > w * 0.4) {
            closeDrawer();
        }
        swipeStart = null;
        swipeDelta = 0;
    }

    function initSwipeToClose() {
        if (!activeDrawer) return;
        activeDrawer.addEventListener('touchstart', onSwipeStart, { passive: true });
        activeDrawer.addEventListener('touchmove', onSwipeMove, { passive: true });
        activeDrawer.addEventListener('touchend', onSwipeEnd);
        activeDrawer.addEventListener('touchcancel', onSwipeEnd);
    }

    function teardownSwipeToClose() {
        if (!activeDrawer) return;
        activeDrawer.removeEventListener('touchstart', onSwipeStart);
        activeDrawer.removeEventListener('touchmove', onSwipeMove);
        activeDrawer.removeEventListener('touchend', onSwipeEnd);
        activeDrawer.removeEventListener('touchcancel', onSwipeEnd);
    }

    // ----- Auto-init ----------------------------------------------------------

    function initToggles() {
        const toggles = document.querySelectorAll(
            '.drawer-toggle, [data-drawer-toggle]'
        );
        toggles.forEach((toggle) => {
            if (toggle.dataset.drawerInited === '1') return;
            toggle.dataset.drawerInited = '1';
            toggle.setAttribute('aria-controls', 'drawer');
            toggle.setAttribute('aria-expanded', 'false');
            if (!toggle.getAttribute('aria-label')) {
                toggle.setAttribute('aria-label', 'Open menu');
            }
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                toggleDrawer(toggle);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initToggles);
    } else {
        initToggles();
    }

    // Programmatic API
    window.MavinDrawer = {
        open: function () {
            const t = document.querySelector('.drawer-toggle, [data-drawer-toggle]');
            if (t) openDrawer(t);
        },
        close: closeDrawer,
        toggle: function () {
            const t = document.querySelector('.drawer-toggle, [data-drawer-toggle]');
            if (t) toggleDrawer(t);
        },
        isOpen: function () {
            return activeDrawer != null;
        }
    };
})();
