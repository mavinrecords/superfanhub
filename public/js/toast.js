/**
 * public/js/toast.js — Mavin SuperFan Hub toast enhancement layer (M3-6)
 *
 * Non-invasive enhancer that watches the DOM for `.toast` elements
 * appended by any of the existing toast implementations
 * (redemption.js, dashboard.js, tasks.html, squads.html, rewards.html,
 * etc.) and adds:
 *
 *   1. Stacking — vertical offset so up to 3 toasts can be visible
 *      simultaneously without overlapping. Older toasts shift up as
 *      newer ones appear.
 *   2. Cap of 3 visible — when a 4th toast lands, the oldest is
 *      dismissed early to keep the screen readable.
 *   3. Dismiss button — adds an `×` close button if the toast does not
 *      already render one (e.g., the inline `showToast` in tasks.html
 *      / squads.html / rewards.html doesn't).
 *   4. Swipe-right to dismiss — pointer-based gesture that translates
 *      the toast horizontally; if the swipe passes 40 % of the toast
 *      width, the toast is dismissed. Disabled when
 *      prefers-reduced-motion is set.
 *
 * Loaded after the page's own toast script, so existing showToast()
 * functions keep working untouched. Enhancement is idempotent — each
 * toast is enhanced at most once via a `data-mavin-enhanced` flag.
 */
(function () {
    'use strict';

    var MAX_VISIBLE = 3;
    var GAP = 12; // px between stacked toasts
    var visible = []; // chronological order; oldest first

    var prefersReducedMotion =
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ----- Stack management --------------------------------------------------

    function isFloatingToast(t) {
        // Skip toasts that live inside a positioned container
        // (redemption.js #toastContainer, .toast-container) — those are
        // already stacked by CSS and don't need our manual offsets.
        var cs = window.getComputedStyle(t);
        if (cs.position !== 'fixed') return false;
        var parent = t.parentElement;
        if (!parent) return true;
        if (parent.id === 'toastContainer') return false;
        if (parent.classList && parent.classList.contains('toast-container')) return false;
        return true;
    }

    function reposition() {
        // Stack from bottom-up: newest at the bottom, older lifted
        // above. Only repositions floating toasts.
        var bottomBase = 32;
        var offset = 0;
        for (var i = visible.length - 1; i >= 0; i--) {
            var t = visible[i];
            if (!isFloatingToast(t)) continue;
            var h = t.offsetHeight || 56;
            t.style.bottom = (bottomBase + offset) + 'px';
            offset += h + GAP;
        }
    }

    // ----- Dismiss -----------------------------------------------------------

    function dismiss(toast, opts) {
        if (!toast || toast.dataset.mavinDismissing === '1') return;
        toast.dataset.mavinDismissing = '1';
        var fast = opts && opts.fast;
        // Trigger fade/slide out via CSS class. Existing implementations
        // also flip opacity inline, so we just hide and remove.
        toast.classList.add('toast-dismissing');
        toast.style.transition = (fast ? 'opacity 150ms, transform 150ms' : 'opacity 250ms, transform 250ms');
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(120%)';
        var delay = fast ? 160 : 280;
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, delay);
    }

    function untrack(toast) {
        var idx = visible.indexOf(toast);
        if (idx >= 0) visible.splice(idx, 1);
        reposition();
    }

    // ----- Dismiss button ----------------------------------------------------

    function ensureDismissButton(toast) {
        // Skip if any existing close affordance is present.
        if (toast.querySelector('.toast-close, .toast-dismiss, [data-toast-close]')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-dismiss';
        btn.setAttribute('aria-label', 'Dismiss notification');
        btn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<line x1="18" y1="6" x2="6" y2="18"/>' +
            '<line x1="6" y1="6" x2="18" y2="18"/>' +
            '</svg>';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            dismiss(toast);
        });
        toast.appendChild(btn);
    }

    // ----- Swipe-right to dismiss --------------------------------------------

    function attachSwipe(toast) {
        if (prefersReducedMotion) return;
        var startX = null;
        var delta = 0;
        var width = 0;

        function onStart(e) {
            var pt = e.touches ? e.touches[0] : e;
            startX = pt.clientX;
            delta = 0;
            width = toast.offsetWidth || 1;
            toast.style.transition = 'none';
        }

        function onMove(e) {
            if (startX == null) return;
            var pt = e.touches ? e.touches[0] : e;
            delta = pt.clientX - startX;
            if (delta > 0) {
                toast.style.transform = 'translateX(' + delta + 'px)';
                toast.style.opacity = String(Math.max(0.3, 1 - delta / width));
            }
        }

        function onEnd() {
            if (startX == null) return;
            toast.style.transition = '';
            if (delta > width * 0.4) {
                dismiss(toast);
            } else {
                toast.style.transform = '';
                toast.style.opacity = '';
            }
            startX = null;
            delta = 0;
        }

        toast.addEventListener('touchstart', onStart, { passive: true });
        toast.addEventListener('touchmove', onMove, { passive: true });
        toast.addEventListener('touchend', onEnd);
        toast.addEventListener('touchcancel', onEnd);
    }

    // ----- Enhance on insertion ----------------------------------------------

    function enhance(toast) {
        if (!toast || toast.dataset.mavinEnhanced === '1') return;
        toast.dataset.mavinEnhanced = '1';

        ensureDismissButton(toast);
        attachSwipe(toast);

        visible.push(toast);
        if (visible.length > MAX_VISIBLE) {
            var oldest = visible.shift();
            dismiss(oldest, { fast: true });
        }
        // Wait for layout to settle before stacking.
        requestAnimationFrame(reposition);

        // Watch the toast itself for removal so we can untrack.
        var parent = toast.parentNode || document.body;
        var removeWatcher = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                for (var j = 0; j < m.removedNodes.length; j++) {
                    if (m.removedNodes[j] === toast) {
                        untrack(toast);
                        removeWatcher.disconnect();
                        return;
                    }
                }
            }
        });
        removeWatcher.observe(parent, { childList: true });
    }

    function scanAdded(node) {
        if (node.nodeType !== 1) return;
        if (node.classList && node.classList.contains('toast')) {
            enhance(node);
            return;
        }
        // Some scripts wrap toasts inside another element; check children.
        if (node.querySelectorAll) {
            var inner = node.querySelectorAll('.toast');
            for (var i = 0; i < inner.length; i++) enhance(inner[i]);
        }
    }

    // ----- Boot --------------------------------------------------------------

    function boot() {
        // Catch any toasts already on the page.
        document.querySelectorAll('.toast').forEach(enhance);

        var bodyObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                for (var j = 0; j < m.addedNodes.length; j++) {
                    scanAdded(m.addedNodes[j]);
                }
            }
        });
        // subtree:true so we also catch toasts inserted into nested
        // containers (e.g., redemption.js appends to #toastContainer).
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Programmatic dismiss-all helper.
    window.MavinToast = {
        dismissAll: function () {
            visible.slice().forEach(function (t) { dismiss(t); });
        }
    };
})();
