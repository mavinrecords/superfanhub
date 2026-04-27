// Spotify Routes — direct Spotify OAuth (no Pathfix).
// Flow:
//   /connect    → returns accounts.spotify.com authorization URL
//   /callback   → exchanges code→tokens, verifies via /me, runs initial sync
//   /status     → local DB check
//   /verify     → live /me call, reconciles DB to reality
//   /sync       → fetches recent plays, awards points
//   /stats      → local streaming stats
//   /disconnect → drops DB row (Spotify has no revocation endpoint)

const express = require('express');
const router = express.Router();
const spotifyService = require('../services/spotifyService');
const { requireUser } = require('../middleware/requireUser');

// ─── SHARED POPUP-CLOSE HTML RENDERERS ────────────────────────────────────
// All three /callback branches (success, explicit error, verification failure)
// render a tiny popup page that posts a message to window.opener and closes.
// Factored out to avoid triplicating the boilerplate.

function renderPopupError(message) {
    const safe = String(message || 'Unknown error')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    return `<!DOCTYPE html>
<html>
<head><title>Spotify</title></head>
<body>
    <span id="errdata" data-err="${safe}" style="display:none"></span>
    <script>
        var errMsg = document.getElementById('errdata').getAttribute('data-err');
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'spotify_error', error: errMsg }, '*');
            setTimeout(function(){ window.close(); }, 400);
        } else {
            window.location.href = '/dashboard?spotify_error=' + encodeURIComponent(errMsg);
        }
    <\/script>
</body>
</html>`;
}

function renderPopupSuccess() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Spotify Connected</title>
    <style>
        body { margin:0; display:flex; align-items:center; justify-content:center;
               height:100vh; background:#0a0b10; color:#fff; font-family:sans-serif;
               flex-direction:column; gap:12px; }
        .icon { font-size:3rem; }
        p { color: #1DB954; font-size:1.1rem; font-weight:600; margin:0; }
        small { color: rgba(255,255,255,0.4); font-size:0.8rem; }
    </style>
</head>
<body>
    <div class="icon">🎵</div>
    <p>Spotify Connected!</p>
    <small>Closing and returning to dashboard…</small>
    <script>
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'spotify_connected' }, '*');
            setTimeout(function(){ window.close(); }, 800);
        } else {
            window.location.href = '/dashboard?spotify_connected=1';
        }
    <\/script>
</body>
</html>`;
}

// ─── ROUTES ─────────────────────────────────────────────────────────────────

/**
 * GET /api/spotify/connect
 * Returns the Spotify OAuth URL for the current user. Frontend opens this URL
 * in a popup. Spotify redirects back to /callback with ?code= and ?state=.
 */
router.get('/connect', requireUser, (req, res) => {
    try {
        const authUrl = spotifyService.getAuthorizationUrl(req.user.id);
        res.json({ authUrl });
    } catch (error) {
        console.error('Spotify connect error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/spotify/callback
 * Spotify redirects here after user auth. Receives ?code= (success) or ?error= (failure).
 *   success: verify state → exchange code for tokens → store → verify via /me → initial sync.
 *   failure: render popup error page.
 */
router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.send(renderPopupError(String(error)));
    }

    const mavinUserId = spotifyService.verifyState(state);
    if (!mavinUserId) {
        return res.send(renderPopupError('Invalid or missing OAuth state (possible CSRF or expired flow)'));
    }

    if (!code) {
        return res.send(renderPopupError('Missing authorization code from Spotify'));
    }

    try {
        // 1. Exchange short-lived code for access/refresh tokens.
        const tokens = await spotifyService.exchangeCodeForTokens(String(code));

        // 2. Persist tokens.
        spotifyService.storeTokens(mavinUserId, tokens);

        // 3. Verify via /me — writes spotify_user_id + display_name.
        const verified = await spotifyService.verifyConnection(mavinUserId);
        if (!verified.connected) {
            return res.send(renderPopupError('Verification failed — please try connecting again'));
        }

        // 4. Non-fatal initial sync (so dashboard shows fresh data immediately).
        try {
            const loyaltyCardService = require('../services/loyaltyCardService');
            const card = loyaltyCardService.getLoyaltyCard(mavinUserId);
            if (card) {
                await spotifyService.processStreamingHistory(mavinUserId, card.tier);
            }
        } catch (e) {
            console.error('Initial sync error (non-fatal):', e.message);
        }

        return res.send(renderPopupSuccess());
    } catch (err) {
        console.error('Spotify callback error:', err);
        return res.send(renderPopupError(err.message || 'Connection failed'));
    }
});

/**
 * GET /api/spotify/status
 * Fast local-DB check. Returns { connected: boolean }.
 */
router.get('/status', requireUser, (req, res) => {
    try {
        const result = spotifyService.checkConnection(req.user.id);
        res.json(result);
    } catch (error) {
        console.error('Spotify status error:', error);
        res.status(500).json({ error: 'Failed to check status', connected: false });
    }
});

/**
 * POST /api/spotify/verify
 * Authoritative live check. Calls /me, reconciles spotify_connections to reality.
 * Frontend polls this every 2s while the OAuth popup is open.
 */
router.post('/verify', requireUser, async (req, res) => {
    try {
        const result = await spotifyService.verifyConnection(req.user.id);
        res.json(result);
    } catch (err) {
        console.error('Spotify verify error:', err.message);
        res.status(500).json({ connected: false, error: 'Verification failed' });
    }
});

/**
 * POST /api/spotify/sync
 * Fetch recently played tracks, award points. Self-heals spotify_connections.
 */
router.post('/sync', requireUser, async (req, res) => {
    try {
        const loyaltyCardService = require('../services/loyaltyCardService');
        const card = loyaltyCardService.getLoyaltyCard(req.user.id);
        const tier = card?.tier || 'bronze';

        const result = await spotifyService.processStreamingHistory(req.user.id, tier);

        // Self-heal: a successful sync proves connection — bump updated_at.
        try { spotifyService.touchConnected(req.user.id); } catch { }

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Spotify sync error:', error.message);

        const msg = String(error.message || '');
        if (msg.includes('not connected') || msg.includes('reconnect') || msg.includes('token expired')) {
            try { spotifyService.markDisconnected(req.user.id); } catch { }
            return res.status(400).json({ error: 'Spotify not connected. Please reconnect.' });
        }

        res.status(500).json({ error: 'Failed to sync streaming data' });
    }
});

/**
 * GET /api/spotify/top/artists?time_range=medium_term&limit=20
 * Requires scope: user-top-read.
 */
router.get('/top/artists', requireUser, async (req, res) => {
    try {
        const timeRange = req.query.time_range || 'medium_term';
        const limit = parseInt(req.query.limit, 10) || 20;
        const data = await spotifyService.getTopArtists(req.user.id, timeRange, limit);
        res.json(data);
    } catch (err) {
        console.error('Spotify top artists error:', err.message);
        const msg = String(err.message || '');
        if (msg.includes('not connected') || msg.includes('token expired') || msg.includes('reconnect')) {
            return res.status(400).json({ error: 'Spotify not connected. Please reconnect.' });
        }
        if (msg.includes('403')) {
            return res.status(403).json({ error: 'Spotify scope user-top-read not granted. Reconnect to re-authorize.' });
        }
        res.status(500).json({ error: 'Failed to fetch top artists' });
    }
});

/**
 * GET /api/spotify/following/mavin
 * Returns { follows:[{spotify_artist_id,follows}], followedCount, totalMavinArtists }.
 * Requires scope: user-follow-read.
 */
router.get('/following/mavin', requireUser, async (req, res) => {
    try {
        const data = await spotifyService.checkFollowsMavinArtists(req.user.id);
        res.json(data);
    } catch (err) {
        console.error('Spotify following/mavin error:', err.message);
        const msg = String(err.message || '');
        if (msg.includes('not connected') || msg.includes('token expired') || msg.includes('reconnect')) {
            return res.status(400).json({ error: 'Spotify not connected. Please reconnect.' });
        }
        if (msg.includes('403')) {
            return res.status(403).json({ error: 'Spotify scope user-follow-read not granted. Reconnect to re-authorize.' });
        }
        res.status(500).json({ error: 'Failed to fetch following status' });
    }
});

/**
 * GET /api/spotify/stats
 * Local DB streaming stats — fast, no API call.
 */
router.get('/stats', requireUser, (req, res) => {
    try {
        const stats = spotifyService.getStreamingStats(req.user.id);
        res.json(stats);
    } catch (error) {
        console.error('Spotify stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

/**
 * POST /api/spotify/disconnect
 * Drops this user's DB row. Spotify has no token-revocation endpoint — users
 * can manually revoke at spotify.com/account/apps if they want to force
 * re-consent on next connect.
 */
router.post('/disconnect', requireUser, (req, res) => {
    try {
        spotifyService.markDisconnected(req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Spotify disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

module.exports = router;
