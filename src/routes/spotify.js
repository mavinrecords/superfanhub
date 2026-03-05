// Spotify Routes — Pathfix OAuth Integration
// Pathfix manages token storage, refresh, and proxied API calls.
// /connect  → Redirect user to Pathfix OAuth connect URL
// /callback → Pathfix posts back here (or redirects) after auth
// /status   → Check if user has connected Spotify via Pathfix
// /sync     → Fetch recent plays via Pathfix proxy, award points
// /stats    → Return local streaming stats from DB
// /disconnect → Remove Pathfix connection for this user

const express = require('express');
const router = express.Router();
const spotifyService = require('../services/spotifyService');
const { requireUser } = require('../middleware/requireUser');

/**
 * GET /api/spotify/connect
 * Returns the Pathfix OAuth URL — frontend redirects user there.
 */
router.get('/connect', requireUser, (req, res) => {
    try {
        const authUrl = spotifyService.getAuthorizationUrl(req.user.id);
        res.json({ authUrl });
    } catch (error) {
        console.error('Spotify connect error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/spotify/callback
 * Pathfix redirects back here after the user authorises Spotify.
 * Pathfix manages the token — we just redirect the user to the dashboard.
 */
router.get('/callback', async (req, res) => {
    const { userId, error } = req.query;

    if (error) {
        // Popup: send error to parent and close
        return res.send(`<!DOCTYPE html><html><head><title>Spotify</title></head><body>
            <script>
                if (window.opener) {
                    window.opener.postMessage({ type: 'spotify_error', error: ${JSON.stringify(error)} }, '*');
                    window.close();
                } else {
                    window.location.href = '/dashboard?spotify_error=' + encodeURIComponent(${JSON.stringify(error)});
                }
            <\/script>
        </body></html>`);
    }

    // Non-fatal first sync
    if (userId) {
        try {
            const loyaltyCardService = require('../services/loyaltyCardService');
            const card = loyaltyCardService.getLoyaltyCard(parseInt(userId));
            if (card) {
                await spotifyService.processStreamingHistory(parseInt(userId), card.tier);
            }
        } catch (e) {
            console.error('Initial sync error (non-fatal):', e.message);
        }
    }

    // Serve a page that closes the popup and notifies the opener
    res.send(`<!DOCTYPE html>
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
        // Notify the parent dashboard window
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'spotify_connected' }, '*');
            setTimeout(() => window.close(), 800);
        } else {
            // Opened in same tab — just redirect
            window.location.href = '/dashboard?spotify_connected=1';
        }
    <\/script>
</body>
</html>`);
});

/**
 * POST /api/spotify/pathfix-webhook
 * Pathfix Event Callback — Pathfix POSTs here when a user connects or disconnects Spotify.
 * Configure this URL in app.pathfix.com → Settings → Event Callback:
 *   http://localhost:3000/api/spotify/pathfix-webhook  (dev)
 *   https://yourdomain.com/api/spotify/pathfix-webhook (prod)
 *
 * Expected payload: { event: "connected"|"disconnected", user_id: "5", spotify_user_id: "...", display_name: "..." }
 */
router.post('/pathfix-webhook', (req, res) => {
    try {
        const { event, user_id, spotify_user_id, display_name } = req.body;
        console.log('[Pathfix Webhook]', JSON.stringify(req.body));

        const mavinUserId = parseInt(user_id);
        if (!mavinUserId) return res.status(400).json({ error: 'Missing user_id' });

        if (event === 'connected' || event === 'spotify.connected' || !event) {
            // Mark connected in our DB — no Pathfix API needed from here on
            spotifyService.markConnected(mavinUserId, spotify_user_id, display_name);
        } else if (event === 'disconnected' || event === 'spotify.disconnected') {
            spotifyService.markDisconnected(mavinUserId);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[Pathfix Webhook] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/spotify/status
 * Check if user has connected Spotify — reads from our local DB (fast, no Pathfix call).
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
 * POST /api/spotify/sync
 * Fetch the user's recently played tracks through Pathfix, award points.
 */
router.post('/sync', requireUser, async (req, res) => {
    try {
        const loyaltyCardService = require('../services/loyaltyCardService');
        const card = loyaltyCardService.getLoyaltyCard(req.user.id);
        const tier = card?.tier || 'bronze';

        const result = await spotifyService.processStreamingHistory(req.user.id, tier);

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Spotify sync error:', error);

        if (error.message.includes('not connected') || error.message.includes('reconnect')) {
            return res.status(400).json({ error: 'Spotify not connected. Please reconnect.' });
        }

        res.status(500).json({ error: 'Failed to sync streaming data' });
    }
});

/**
 * GET /api/spotify/stats
 * Return streaming stats from local DB (fast, no Pathfix call needed).
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
 * Tell Pathfix to remove this user's Spotify connection.
 */
router.post('/disconnect', requireUser, async (req, res) => {
    try {
        spotifyService.markDisconnected(req.user.id);
        await spotifyService.disconnectPathfix(req.user.id).catch(() => { });
        res.json({ success: true });
    } catch (error) {
        console.error('Spotify disconnect error:', error);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

module.exports = router;
