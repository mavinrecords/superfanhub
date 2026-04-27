// Last.fm Routes — zero-OAuth power-user path (Phase 1.5).
//
// Flow:
//   POST /connect    { username } → validates via user.getInfo, stores row,
//                                    runs initial 7-day sync.
//   GET  /status                  → local DB check (fast).
//   POST /sync                    → incremental pull of new scrobbles,
//                                    applies shared daily cap + variety bonus.
//   GET  /stats                   → local DB scrobble stats.
//   POST /disconnect              → drops the DB row.
//
// No OAuth callback route — Last.fm doesn't use OAuth for the read endpoints
// we need (user.getRecentTracks, user.getInfo). That's the whole point: users
// who already scrobble Spotify → Last.fm can type a username and get credit
// without another consent popup.

const express = require('express');
const router = express.Router();
const lastfmService = require('../services/lastfmService');
const { requireUser } = require('../middleware/requireUser');

/**
 * POST /api/lastfm/connect
 * Body: { username: string }
 * Validates the Last.fm username, stores the connection, runs an initial sync.
 */
router.post('/connect', requireUser, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    if (!username) {
        return res.status(400).json({ error: 'username is required' });
    }

    try {
        const profile = await lastfmService.validateUsername(username);
        lastfmService.storeConnection(req.user.id, profile);

        // Non-fatal initial sync — if Last.fm is slow, connection still succeeds.
        let syncResult = null;
        try {
            const loyaltyCardService = require('../services/loyaltyCardService');
            const card = loyaltyCardService.getLoyaltyCard(req.user.id);
            const tier = card?.tier || 'bronze';
            syncResult = await lastfmService.processScrobbles(req.user.id, tier);
        } catch (e) {
            console.error('[Lastfm /connect] initial sync (non-fatal):', e.message);
        }

        return res.json({
            success: true,
            connection: {
                username: profile.username,
                displayName: profile.display_name,
                playcount: profile.playcount,
                registeredUnix: profile.registered_unix
            },
            initialSync: syncResult
        });
    } catch (err) {
        console.error('[Lastfm /connect] error:', err.message);
        return res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/lastfm/status
 * Fast local-DB check. Returns { connected, username?, displayName?, ... }.
 */
router.get('/status', requireUser, (req, res) => {
    try {
        const result = lastfmService.checkConnection(req.user.id);
        return res.json(result);
    } catch (err) {
        console.error('[Lastfm /status] error:', err.message);
        return res.status(500).json({ error: 'Failed to check status', connected: false });
    }
});

/**
 * POST /api/lastfm/sync
 * Incremental pull of new scrobbles for a connected user. Applies the shared
 * daily-mavin-minutes cap + variety bonus used by the Spotify path.
 */
router.post('/sync', requireUser, async (req, res) => {
    try {
        const loyaltyCardService = require('../services/loyaltyCardService');
        const card = loyaltyCardService.getLoyaltyCard(req.user.id);
        const tier = card?.tier || 'bronze';
        const result = await lastfmService.processScrobbles(req.user.id, tier);
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Lastfm /sync] error:', err.message);
        if (/not connected/i.test(err.message)) {
            return res.status(400).json({ error: 'Last.fm not connected. Please connect first.' });
        }
        return res.status(500).json({ error: 'Failed to sync Last.fm scrobbles' });
    }
});

/**
 * GET /api/lastfm/stats
 * Local DB stats for scrobbles ingested from Last.fm (rows with lf: prefix).
 */
router.get('/stats', requireUser, (req, res) => {
    try {
        const stats = lastfmService.getScrobbleStats(req.user.id);
        return res.json(stats);
    } catch (err) {
        console.error('[Lastfm /stats] error:', err.message);
        return res.status(500).json({ error: 'Failed to get Last.fm stats' });
    }
});

/**
 * POST /api/lastfm/disconnect
 * Drops the lastfm_connections row. Historical scrobbles in streaming_history
 * are preserved (immutable facts — same pattern as Spotify disconnect).
 */
router.post('/disconnect', requireUser, (req, res) => {
    try {
        lastfmService.markDisconnected(req.user.id);
        return res.json({ success: true });
    } catch (err) {
        console.error('[Lastfm /disconnect] error:', err.message);
        return res.status(500).json({ error: 'Failed to disconnect Last.fm' });
    }
});

module.exports = router;
