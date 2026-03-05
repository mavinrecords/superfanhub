// Spotify Integration Service — powered by Pathfix OAuth
// Pathfix manages OAuth flow, token storage, and token refresh automatically.
// We never store raw Spotify tokens. All Spotify API calls go through Pathfix proxy.

const { getDatabase } = require('../db/database');

const PATHFIX_API_KEY = process.env.PATHFIX_API_KEY || '901B9B27-BCD0-482F-9F44-7443778A0542';
const PATHFIX_BASE = 'https://api.pathfix.com';
const PATHFIX_LABS = 'https://labs.pathfix.com';

// Points per Mavin minute streamed
const POINTS_PER_MINUTE = 1;
const BONUS_MULTIPLIER = {
    bronze: 1,
    silver: 1.2,
    gold: 1.5,
    platinum: 2,
    diamond: 2.5
};

// Mavin artist Spotify IDs (comma-separated in env)
const MAVIN_ARTIST_IDS = (process.env.MAVIN_ARTIST_IDS || '').split(',').filter(Boolean);

// ─── PATHFIX HELPERS ───────────────────────────────────────────────────────

/**
 * Build the Pathfix OAuth connect URL for a given Mavin user.
 * Correct format confirmed: https://labs.pathfix.com/integrate/page?public_key=...&user_id=...
 */
function getAuthorizationUrl(mavinUserId) {
    const params = new URLSearchParams({
        public_key: PATHFIX_API_KEY,
        user_id: String(mavinUserId)
    });

    return `${PATHFIX_LABS}/integrate/page?${params}`;
}

/**
 * Call a Spotify API endpoint through the Pathfix pass-through proxy.
 * Correct endpoint: https://labs.pathfix.com/oauth/method/spotify/call
 * Spotify API path goes in the `url` query param.
 * Pathfix auto-injects the user's access token.
 */
async function pathfixRequest(mavinUserId, spotifyPath, method = 'GET', body = null) {
    const spotifyBase = 'https://api.spotify.com/v1';
    const targetUrl = `${spotifyBase}${spotifyPath}`;

    console.log(`[Pathfix] proxy call → user:${mavinUserId} path:${spotifyPath}`);

    const res = await fetch(`${PATHFIX_LABS}/oauth/method/spotify/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            public_key: PATHFIX_API_KEY,
            user_id: String(mavinUserId),
            url: targetUrl,
            method: method,
            ...(body ? { body: JSON.stringify(body) } : {})
        })
    });

    const rawText = await res.text();
    console.log(`[Pathfix] HTTP ${res.status} → ${rawText.slice(0, 500)}`);

    if (res.status === 401 || res.status === 403) {
        throw new Error('Spotify not connected or token expired — user must reconnect');
    }
    if (!res.ok) {
        throw new Error(`Pathfix proxy error ${res.status}: ${rawText}`);
    }
    try { return JSON.parse(rawText); } catch { return rawText; }
}

/**
 * Check connection status from our own DB — no Pathfix API call needed.
 * The Event Callback webhook writes to spotify_connections when user connects.
 */
function checkConnection(mavinUserId) {
    try {
        const db = getDatabase();
        const row = db.prepare(
            `SELECT id FROM spotify_connections WHERE user_id = ? AND spotify_user_id IS NOT NULL AND spotify_user_id != ''`
        ).get(mavinUserId);
        return { connected: !!row };
    } catch (e) {
        console.error('[Spotify] checkConnection DB error:', e.message);
        return { connected: false };
    }
}

/**
 * Called by the Pathfix Event Callback webhook when a user connects Spotify.
 * Upserts a lightweight record so checkConnection() returns true.
 */
function markConnected(mavinUserId, spotifyUserId, displayName) {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO spotify_connections (user_id, spotify_user_id, display_name, access_token, refresh_token, token_expires_at, updated_at)
        VALUES (?, ?, ?, 'pathfix_managed', 'pathfix_managed', datetime('now', '+1 hour'), datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
            spotify_user_id = excluded.spotify_user_id,
            display_name    = excluded.display_name,
            updated_at      = datetime('now')
    `).run(mavinUserId, spotifyUserId || 'pathfix_user', displayName || '');
    console.log(`[Spotify] markConnected userId=${mavinUserId} spotifyId=${spotifyUserId}`);
}

/**
 * Called when user disconnects — removes the DB record.
 */
function markDisconnected(mavinUserId) {
    const db = getDatabase();
    db.prepare(`DELETE FROM spotify_connections WHERE user_id = ?`).run(mavinUserId);
    console.log(`[Spotify] markDisconnected userId=${mavinUserId}`);
}

/**
 * Disconnect user's Spotify via Pathfix.
 */
async function disconnectPathfix(mavinUserId) {
    try {
        const res = await fetch(`${PATHFIX_BASE}/oauth/disconnect/spotify/${mavinUserId}`, {
            method: 'DELETE',
            headers: { 'x-api-key': PATHFIX_API_KEY }
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ─── SPOTIFY DATA ──────────────────────────────────────────────────────────

/**
 * Get user's Spotify profile (used to confirm identity on connect).
 */
async function getSpotifyProfile(mavinUserId) {
    return pathfixRequest(mavinUserId, '/me');
}

/**
 * Get recently played tracks for a user.
 */
async function getRecentlyPlayed(mavinUserId, limit = 50) {
    return pathfixRequest(mavinUserId, `/me/player/recently-played?limit=${limit}`);
}

/**
 * Check if a track is by a Mavin artist.
 */
function isMavinTrack(track) {
    if (MAVIN_ARTIST_IDS.length === 0) return false;
    return track.artists?.some(a => MAVIN_ARTIST_IDS.includes(a.id));
}

/**
 * Process streaming history and award loyalty points.
 */
async function processStreamingHistory(mavinUserId, userTier = 'bronze') {
    const db = getDatabase();

    const { items } = await getRecentlyPlayed(mavinUserId);

    if (!items || items.length === 0) {
        return { processed: 0, pointsAwarded: 0 };
    }

    let totalMinutes = 0;
    let mavinMinutes = 0;

    for (const item of items) {
        const track = item.track;
        const durationMinutes = track.duration_ms / 60000;

        // Skip already-processed plays
        const existing = db.prepare(`
            SELECT id FROM streaming_history
            WHERE user_id = ? AND spotify_track_id = ? AND played_at = ?
        `).get(mavinUserId, track.id, item.played_at);

        if (existing) continue;

        const isMavin = isMavinTrack(track);

        db.prepare(`
            INSERT INTO streaming_history
            (user_id, spotify_track_id, track_name, artist_name, duration_ms, played_at, is_mavin_artist, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            mavinUserId,
            track.id,
            track.name,
            track.artists.map(a => a.name).join(', '),
            track.duration_ms,
            item.played_at,
            isMavin ? 1 : 0
        );

        totalMinutes += durationMinutes;
        if (isMavin) mavinMinutes += durationMinutes;
    }

    // Award points for Mavin streams only
    const multiplier = BONUS_MULTIPLIER[userTier] || 1;
    const pointsAwarded = Math.floor(mavinMinutes * POINTS_PER_MINUTE * multiplier);

    if (pointsAwarded > 0) {
        const loyaltyCardService = require('./loyaltyCardService');
        loyaltyCardService.addPoints(mavinUserId, pointsAwarded, 'Spotify streaming reward', 'streaming');
    }

    return {
        processed: items.length,
        totalMinutes: Math.round(totalMinutes),
        mavinMinutes: Math.round(mavinMinutes),
        pointsAwarded
    };
}

/**
 * Get streaming stats for a user (from local DB, not Pathfix).
 */
function getStreamingStats(userId) {
    const db = getDatabase();
    const stats = db.prepare(`
        SELECT
            COUNT(*) as total_plays,
            SUM(duration_ms) / 60000.0 as total_minutes,
            SUM(CASE WHEN is_mavin_artist = 1 THEN duration_ms ELSE 0 END) / 60000.0 as mavin_minutes,
            COUNT(CASE WHEN is_mavin_artist = 1 THEN 1 END) as mavin_plays
        FROM streaming_history
        WHERE user_id = ?
    `).get(userId);

    return {
        totalPlays: stats.total_plays || 0,
        totalMinutes: Math.round(stats.total_minutes || 0),
        mavinMinutes: Math.round(stats.mavin_minutes || 0),
        mavinPlays: stats.mavin_plays || 0
    };
}

// ─── LEGACY SHIMS (kept for any code still referencing old signatures) ─────

/** @deprecated Use getAuthorizationUrl(userId) instead */
function generateState() {
    return require('crypto').randomBytes(16).toString('hex');
}

/** @deprecated Token management now handled by Pathfix */
function getConnection(userId) { return null; }

/** @deprecated Token management now handled by Pathfix */
function saveConnection() { }

/** @deprecated Use disconnectPathfix(userId) */
function disconnect(userId) { return disconnectPathfix(userId); }

module.exports = {
    getAuthorizationUrl,
    checkConnection,
    markConnected,
    markDisconnected,
    disconnectPathfix,
    disconnect,
    getSpotifyProfile,
    getRecentlyPlayed,
    processStreamingHistory,
    getStreamingStats,
    getConnection,
    saveConnection,
    generateState,
    MAVIN_ARTIST_IDS,
    PATHFIX_API_KEY
};
