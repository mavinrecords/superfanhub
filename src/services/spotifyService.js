// Spotify Integration Service — direct Spotify OAuth (no Pathfix).
//
// Flow:
//   1. Frontend calls GET /api/spotify/connect → we return the Spotify auth URL.
//   2. User authorises on accounts.spotify.com → Spotify redirects to /api/spotify/callback?code=&state=.
//   3. /callback verifies the signed state, exchanges code for {access_token, refresh_token, expires_in},
//      stores them in spotify_connections, and calls /me to confirm + grab display_name.
//   4. All subsequent API calls go through spotifyRequest() which reads the stored
//      access_token, transparently refreshes when expired, and retries on 401 by
//      force-refreshing exactly once.

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const artistService = require('./artistService');
const { fetchWithRetry } = require('./apiRetryHelper');

// ─── SPOTIFY APP CONFIG ────────────────────────────────────────────────────
// Set these in .env after creating your app at https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI
    || `${process.env.BASE_URL || 'http://localhost:3000'}/api/spotify/callback`;

// OAuth scopes we request. The first three are the feature-critical ones —
// without them the sync / top-artists / following-mavin endpoints return 403.
const SPOTIFY_SCOPES = [
    'user-read-recently-played',  // /me/player/recently-played
    'user-top-read',              // /me/top/artists
    'user-follow-read',           // /me/following/contains
    'user-read-private',          // /me (to get spotify_user_id)
    'user-read-email'             // /me.email (optional — surfaces on dashboard)
].join(' ');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_AUTH = 'https://accounts.spotify.com';

// HMAC signing secret for the OAuth `state` param. Reuses the session secret
// so we don't add a second secret to manage. Must be stable across restarts
// or in-flight OAuth popups will fail state verification.
const STATE_SECRET = process.env.SESSION_SECRET || 'dev-state-secret-change-in-production';

// ─── POINTS CONFIG ─────────────────────────────────────────────────────────
const POINTS_PER_MINUTE = 1;
const BONUS_MULTIPLIER = {
    bronze: 1,
    silver: 1.2,
    gold: 1.5,
    platinum: 2,
    diamond: 2.5
};

// ─── FRAUD PREVENTION TUNABLES ──────────────────────────────────────────────
const DAILY_MAVIN_MINUTES_CAP = 300;
const VARIETY_BONUS_THRESHOLD = 5;
const VARIETY_BONUS_MULTIPLIER = 1.1;
const MAX_PAGES_PER_SYNC = 5;

const LEGACY_MAVIN_ARTIST_IDS = (process.env.MAVIN_ARTIST_IDS || '').split(',').filter(Boolean);

// ─── STATE (CSRF) SIGNING ──────────────────────────────────────────────────

/**
 * Build a tamper-evident state string that ties the OAuth flow to this Mavin
 * user. Prevents an attacker from tricking someone into OAuth-linking a
 * different user's Spotify account.
 *
 * Format: <mavinUserId>.<random nonce>.<hmac(mavinUserId.nonce, SESSION_SECRET)>
 */
function signState(mavinUserId) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `${mavinUserId}.${nonce}`;
    const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

/**
 * Verify a state string from the OAuth callback. Returns the extracted
 * mavinUserId (number) on success, or null if the signature is missing/invalid.
 */
function verifyState(state) {
    if (!state || typeof state !== 'string') return null;
    const parts = state.split('.');
    if (parts.length !== 3) return null;
    const [userId, nonce, sig] = parts;
    if (!userId || !nonce || !sig) return null;
    const expected = crypto.createHmac('sha256', STATE_SECRET)
        .update(`${userId}.${nonce}`)
        .digest('hex');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const parsed = parseInt(userId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// ─── OAUTH URL ─────────────────────────────────────────────────────────────

/**
 * Build the Spotify OAuth authorization URL for a given Mavin user.
 * The user's browser navigates here (via popup from the dashboard), sees
 * Spotify's native consent screen, and is redirected back to /callback with a
 * short-lived `code`.
 */
function getAuthorizationUrl(mavinUserId) {
    if (!SPOTIFY_CLIENT_ID) {
        throw new Error('SPOTIFY_CLIENT_ID is not configured. See developer.spotify.com/dashboard.');
    }
    const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: SPOTIFY_REDIRECT_URI,
        scope: SPOTIFY_SCOPES,
        state: signState(mavinUserId),
        show_dialog: 'false'
    });
    return `${SPOTIFY_AUTH}/authorize?${params}`;
}

// ─── TOKEN MANAGEMENT ──────────────────────────────────────────────────────

/**
 * Exchange an authorization code for an access/refresh token pair.
 * Called from /api/spotify/callback once Spotify redirects back with ?code=.
 * Returns Spotify's raw token response: { access_token, refresh_token, expires_in, scope, token_type }.
 */
async function exchangeCodeForTokens(code) {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        throw new Error('Spotify client credentials not configured');
    }
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI
    });
    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Spotify token exchange failed: ${res.status} ${txt}`);
    }
    return res.json();
}

/**
 * Use a stored refresh_token to get a fresh access_token. Called transparently
 * by getValidAccessToken() when the stored access_token is expired, and also
 * by spotifyRequest() on 401 responses (token silently invalidated, rare).
 *
 * On refresh failure → markDisconnected (forces reconnect UX).
 */
async function refreshAccessToken(mavinUserId) {
    const db = getDatabase();
    const row = db.prepare(
        `SELECT refresh_token FROM spotify_connections WHERE user_id = ?`
    ).get(mavinUserId);
    if (!row || !row.refresh_token || row.refresh_token === 'pathfix_managed' || row.refresh_token === '') {
        throw new Error('Spotify not connected or no refresh token — user must reconnect');
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token
    });
    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
    if (!res.ok) {
        const txt = await res.text();
        console.error(`[Spotify] refresh failed for user ${mavinUserId}: ${res.status} ${txt}`);
        markDisconnected(mavinUserId);
        throw new Error('Spotify refresh failed — user must reconnect');
    }
    const tokens = await res.json(); // { access_token, token_type, expires_in, scope, refresh_token? }

    // Spotify may or may not rotate the refresh_token; preserve the old one if
    // a new one isn't returned.
    const expiresInSec = Math.max(60, (tokens.expires_in || 3600) - 60); // 60s safety buffer
    db.prepare(`UPDATE spotify_connections SET
        access_token = ?,
        refresh_token = COALESCE(?, refresh_token),
        token_expires_at = datetime('now', '+' || ? || ' seconds'),
        updated_at = datetime('now')
        WHERE user_id = ?`)
      .run(tokens.access_token, tokens.refresh_token || null, expiresInSec, mavinUserId);
    return tokens.access_token;
}

/**
 * Return an access_token that is valid right now (refreshing if needed).
 */
async function getValidAccessToken(mavinUserId) {
    const db = getDatabase();
    const row = db.prepare(
        `SELECT access_token, token_expires_at FROM spotify_connections WHERE user_id = ?`
    ).get(mavinUserId);

    if (!row || !row.access_token || row.access_token === 'pathfix_managed' || row.access_token === '') {
        throw new Error('Spotify not connected — user must connect via OAuth');
    }

    const expired = !row.token_expires_at || new Date(row.token_expires_at) <= new Date();
    if (expired) return refreshAccessToken(mavinUserId);
    return row.access_token;
}

/**
 * Persist a fresh token triple after /callback's code exchange.
 * UPSERT — preserves any existing spotify_user_id/display_name (filled in
 * subsequently by verifyConnection's /me call).
 */
function storeTokens(mavinUserId, tokens) {
    if (!tokens || !tokens.access_token || !tokens.refresh_token) {
        throw new Error('storeTokens: access_token and refresh_token are required');
    }
    const db = getDatabase();
    const expiresInSec = Math.max(60, (tokens.expires_in || 3600) - 60);
    db.prepare(`
        INSERT INTO spotify_connections
            (user_id, spotify_user_id, display_name, access_token, refresh_token, token_expires_at, created_at, updated_at)
        VALUES (?, '', '', ?, ?, datetime('now', '+' || ? || ' seconds'), datetime('now'), datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            token_expires_at = excluded.token_expires_at,
            updated_at = datetime('now')
    `).run(mavinUserId, tokens.access_token, tokens.refresh_token, expiresInSec);
    console.log(`[Spotify] storeTokens userId=${mavinUserId} expiresIn=${expiresInSec}s`);
}

// ─── DIRECT SPOTIFY API REQUEST ────────────────────────────────────────────

/**
 * Call a Spotify API endpoint directly with the user's stored access token.
 * Handles:
 *   - Automatic refresh when token is expired (getValidAccessToken).
 *   - 429 rate-limit retry via the shared apiRetryHelper (Retry-After aware).
 *   - 401 response → force refresh + retry exactly once (covers the edge case
 *     where Spotify invalidates a token before its stated expiry, e.g. after
 *     password change or manual app revocation).
 *   - 403 response → throw a scope-not-granted error (caller maps to user-facing
 *     "please reconnect to grant more permissions" message).
 *
 * @param {number} mavinUserId
 * @param {string} spotifyPath  e.g. '/me' or '/me/player/recently-played?limit=50'
 * @param {string} [method='GET']
 * @param {object} [body]       JSON-serialisable body for POST/PUT
 */
async function spotifyRequest(mavinUserId, spotifyPath, method = 'GET', body = null) {
    const token = await getValidAccessToken(mavinUserId);
    const url = `${SPOTIFY_API}${spotifyPath}`;
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';

    console.log(`[Spotify] ${method} ${spotifyPath} user:${mavinUserId}`);

    let res = await fetchWithRetry(
        url,
        { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) },
        { label: 'spotify' }
    );

    // Edge case: token was revoked server-side before its stated expiry.
    // Force a refresh (ignoring our local expiry check) and retry once.
    if (res.status === 401) {
        console.warn(`[Spotify] 401 on ${spotifyPath} — force-refreshing token for user ${mavinUserId}`);
        let fresh;
        try {
            fresh = await refreshAccessToken(mavinUserId);
        } catch (e) {
            throw new Error('Spotify not connected or token expired — user must reconnect');
        }
        res = await fetchWithRetry(
            url,
            {
                method,
                headers: { Authorization: `Bearer ${fresh}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            },
            { label: 'spotify' }
        );
        if (res.status === 401 || res.status === 403) {
            markDisconnected(mavinUserId);
            throw new Error('Spotify not connected or token expired — user must reconnect');
        }
    }

    if (res.status === 403) {
        throw new Error(`Spotify 403 on ${spotifyPath}: scope not granted (reconnect to re-authorize)`);
    }

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Spotify API error ${res.status} on ${spotifyPath}: ${txt.slice(0, 200)}`);
    }

    // Some Spotify endpoints return empty body on success (e.g. 204 No Content).
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

// ─── CONNECTION STATE ──────────────────────────────────────────────────────

/**
 * Check connection status from our own DB — no Spotify API call.
 * Requires a real access_token (not empty, not the legacy 'pathfix_managed' placeholder).
 */
function checkConnection(mavinUserId) {
    try {
        const db = getDatabase();
        const row = db.prepare(`
            SELECT id FROM spotify_connections
            WHERE user_id = ?
              AND spotify_user_id IS NOT NULL
              AND spotify_user_id != ''
              AND access_token IS NOT NULL
              AND access_token != ''
              AND access_token != 'pathfix_managed'
        `).get(mavinUserId);
        return { connected: !!row };
    } catch (e) {
        console.error('[Spotify] checkConnection DB error:', e.message);
        return { connected: false };
    }
}

/**
 * Mark a user as connected. Called by verifyConnection() after a successful
 * /me call to fill in spotify_user_id and display_name.
 * Does NOT touch access_token / refresh_token — those are owned by storeTokens().
 */
function markConnected(mavinUserId, spotifyUserId, displayName) {
    const db = getDatabase();
    db.prepare(`
        UPDATE spotify_connections SET
            spotify_user_id = ?,
            display_name = ?,
            updated_at = datetime('now')
        WHERE user_id = ?
    `).run(spotifyUserId || '', displayName || '', mavinUserId);
    console.log(`[Spotify] markConnected userId=${mavinUserId} spotifyId=${spotifyUserId}`);
}

/**
 * Disconnect — removes the DB record. Spotify has no user-level token revocation
 * endpoint; the user can manually revoke app access at spotify.com/account/apps.
 */
function markDisconnected(mavinUserId) {
    const db = getDatabase();
    db.prepare(`DELETE FROM spotify_connections WHERE user_id = ?`).run(mavinUserId);
    console.log(`[Spotify] markDisconnected userId=${mavinUserId}`);
}

/**
 * Self-heal bump for /sync — only touches updated_at, never clobbers tokens or
 * identity. If the user isn't connected (no row exists), this is a no-op.
 */
function touchConnected(mavinUserId) {
    const db = getDatabase();
    db.prepare(`
        UPDATE spotify_connections
        SET updated_at = datetime('now')
        WHERE user_id = ?
    `).run(mavinUserId);
}

/**
 * Live-verify Spotify connection by calling /me.
 * Used by /api/spotify/verify (frontend polls while OAuth popup is open) and by
 * /callback right after storing tokens. Reconciles DB to reality:
 *   200      → markConnected (fills in spotify_user_id + display_name)
 *   401/403  → markDisconnected (clears stale row)
 *   other    → throw
 */
async function verifyConnection(mavinUserId) {
    try {
        const profile = await spotifyRequest(mavinUserId, '/me');
        const spotifyUserId = profile?.id || null;
        const displayName = profile?.display_name || '';
        markConnected(mavinUserId, spotifyUserId, displayName);
        return { connected: true, spotify_user_id: spotifyUserId, display_name: displayName };
    } catch (err) {
        const msg = String(err.message || '');
        if (
            msg.includes('not connected') ||
            msg.includes('must reconnect') ||
            msg.includes('token expired') ||
            msg.includes('401') ||
            msg.includes('403')
        ) {
            markDisconnected(mavinUserId);
            return { connected: false };
        }
        throw err;
    }
}

// ─── SPOTIFY DATA ──────────────────────────────────────────────────────────

async function getSpotifyProfile(mavinUserId) {
    return spotifyRequest(mavinUserId, '/me');
}

/**
 * Recently played tracks. Cursor pagination via `before` (Unix ms).
 * Spotify's max limit per call is 50. Podcasts are excluded server-side.
 */
async function getRecentlyPlayed(mavinUserId, limit = 50, before = null) {
    const params = new URLSearchParams({ limit: String(Math.min(50, limit)) });
    if (before) params.set('before', String(before));
    return spotifyRequest(mavinUserId, `/me/player/recently-played?${params}`);
}

/**
 * User's top artists.
 *   time_range: 'short_term' (~4wk) | 'medium_term' (~6mo, default) | 'long_term' (years)
 * Requires scope: user-top-read.
 */
async function getTopArtists(mavinUserId, timeRange = 'medium_term', limit = 20) {
    const allowedRanges = ['short_term', 'medium_term', 'long_term'];
    const range = allowedRanges.includes(timeRange) ? timeRange : 'medium_term';
    const params = new URLSearchParams({
        time_range: range,
        limit: String(Math.min(50, Math.max(1, limit)))
    });
    return spotifyRequest(mavinUserId, `/me/top/artists?${params}`);
}

/**
 * For each Mavin artist in the active allowlist, report whether this user
 * follows them. Requires scope: user-follow-read.
 *
 * Returns: { follows: [{spotify_artist_id, follows}], followedCount, totalMavinArtists }
 */
async function checkFollowsMavinArtists(mavinUserId) {
    const ids = Array.from(artistService.getMavinSpotifyIds());
    if (ids.length === 0) {
        return { follows: [], followedCount: 0, totalMavinArtists: 0 };
    }

    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    const follows = [];
    for (const chunk of chunks) {
        const params = new URLSearchParams({ type: 'artist', ids: chunk.join(',') });
        const result = await spotifyRequest(mavinUserId, `/me/following/contains?${params}`);
        const bools = Array.isArray(result) ? result : (result?.data || []);
        chunk.forEach((id, idx) => follows.push({ spotify_artist_id: id, follows: !!bools[idx] }));
    }

    return {
        follows,
        followedCount: follows.filter(f => f.follows).length,
        totalMavinArtists: ids.length
    };
}

/**
 * Check if a track is by an active Mavin artist.
 *
 * Fraud defense: local files (is_local=true) are always rejected, so a user
 * can't name a local mp3 "Rema - Calm Down" and have it count.
 */
function isMavinTrack(track) {
    if (!track?.artists?.length) return false;
    if (track.is_local === true) return false;
    let ids = artistService.getMavinSpotifyIds();
    if (ids.size === 0 && LEGACY_MAVIN_ARTIST_IDS.length > 0) {
        ids = new Set(LEGACY_MAVIN_ARTIST_IDS);
    }
    if (ids.size === 0) return false;
    return track.artists.some(a => ids.has(a.id));
}

/**
 * Process streaming history and award loyalty points. Unchanged from the
 * hardened version — all data-source logic lives in getRecentlyPlayed() which
 * now calls Spotify directly instead of via Pathfix.
 *
 * Hardening summary:
 *   • Paginate via `before` cursor up to MAX_PAGES_PER_SYNC.
 *   • Stop once we reach the previous sync's high-water mark.
 *   • DAILY_MAVIN_MINUTES_CAP caps point-earning minutes per day.
 *   • VARIETY_BONUS_MULTIPLIER rewards >=5 distinct Mavin tracks/day.
 *   • Per-row points_awarded back-fill gives a truthful history.
 */
async function processStreamingHistory(mavinUserId, userTier = 'bronze') {
    const db = getDatabase();

    const highWater = db.prepare(
        `SELECT MAX(played_at) AS max_played FROM streaming_history WHERE user_id = ?`
    ).get(mavinUserId)?.max_played || null;

    const insertStmt = db.prepare(`
        INSERT INTO streaming_history
        (user_id, spotify_track_id, track_name, artist_name, duration_ms, played_at, is_mavin_artist, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const dedupeStmt = db.prepare(`
        SELECT id FROM streaming_history
        WHERE user_id = ? AND spotify_track_id = ? AND played_at = ?
    `);

    let totalMinutes = 0;
    let mavinMinutes = 0;
    let processed = 0;
    let pagesFetched = 0;
    const insertedMavinRowIds = [];
    const distinctMavinTracksThisSync = new Set();

    let before = null;
    let stop = false;

    for (let page = 0; page < MAX_PAGES_PER_SYNC && !stop; page++) {
        const response = await getRecentlyPlayed(mavinUserId, 50, before);
        pagesFetched++;

        const items = response?.items || [];
        if (items.length === 0) break;

        let pageOldest = null;

        for (const item of items) {
            const track = item?.track;
            if (!track) continue;

            if (!pageOldest || item.played_at < pageOldest) pageOldest = item.played_at;

            const existing = dedupeStmt.get(mavinUserId, track.id, item.played_at);
            if (existing) continue;

            const isMavin = isMavinTrack(track);
            const durationMinutes = track.duration_ms / 60000;

            const info = insertStmt.run(
                mavinUserId,
                track.id,
                track.name,
                (track.artists || []).map(a => a.name).join(', '),
                track.duration_ms,
                item.played_at,
                isMavin ? 1 : 0
            );

            processed++;
            totalMinutes += durationMinutes;
            if (isMavin) {
                mavinMinutes += durationMinutes;
                insertedMavinRowIds.push(info.lastInsertRowid);
                distinctMavinTracksThisSync.add(track.id);
            }
        }

        if (highWater && pageOldest && pageOldest <= highWater) stop = true;
        const nextBefore = response?.cursors?.before;
        if (!nextBefore) stop = true;
        before = nextBefore;
    }

    // Daily cap
    const todayMavinMins = db.prepare(`
        SELECT COALESCE(SUM(duration_ms), 0) / 60000.0 AS mins
        FROM streaming_history
        WHERE user_id = ? AND is_mavin_artist = 1 AND DATE(played_at) = DATE('now')
    `).get(mavinUserId)?.mins || 0;

    const todayBeforeSync = Math.max(0, todayMavinMins - mavinMinutes);
    const remainingBudget = Math.max(0, DAILY_MAVIN_MINUTES_CAP - todayBeforeSync);
    const creditableMinutes = Math.min(mavinMinutes, remainingBudget);

    // Variety bonus
    const distinctTracksToday = db.prepare(`
        SELECT COUNT(DISTINCT spotify_track_id) AS n
        FROM streaming_history
        WHERE user_id = ? AND is_mavin_artist = 1 AND DATE(played_at) = DATE('now')
    `).get(mavinUserId)?.n || 0;

    const varietyMultiplier = distinctTracksToday >= VARIETY_BONUS_THRESHOLD
        ? VARIETY_BONUS_MULTIPLIER
        : 1;

    // Award points
    const tierMultiplier = BONUS_MULTIPLIER[userTier] || 1;
    const effectiveRate = POINTS_PER_MINUTE * tierMultiplier * varietyMultiplier;
    const pointsAwarded = Math.floor(creditableMinutes * effectiveRate);

    if (pointsAwarded > 0) {
        const loyaltyCardService = require('./loyaltyCardService');
        loyaltyCardService.addPoints(mavinUserId, pointsAwarded, 'Spotify streaming reward', 'streaming');

        if (insertedMavinRowIds.length > 0 && creditableMinutes > 0) {
            const rowDurations = db.prepare(
                `SELECT id, duration_ms FROM streaming_history WHERE id IN (${insertedMavinRowIds.map(() => '?').join(',')})`
            ).all(...insertedMavinRowIds);
            const byId = new Map(rowDurations.map(r => [r.id, r.duration_ms]));

            let creditedSoFar = 0;
            const updateStmt = db.prepare(`UPDATE streaming_history SET points_awarded = ? WHERE id = ?`);
            for (let i = 0; i < insertedMavinRowIds.length; i++) {
                const id = insertedMavinRowIds[i];
                const rowMins = (byId.get(id) || 0) / 60000;
                const isLast = i === insertedMavinRowIds.length - 1;
                const remainingCreditable = Math.max(0, creditableMinutes - (i > 0 ? creditedSoFar : 0));
                const rowCreditable = Math.min(rowMins, remainingCreditable);
                let rowPoints = isLast
                    ? Math.max(0, pointsAwarded - sumPrevious(insertedMavinRowIds, i, byId, creditableMinutes, effectiveRate))
                    : Math.floor(rowCreditable * effectiveRate);
                creditedSoFar += rowCreditable;
                updateStmt.run(rowPoints, id);
            }
        }
    }

    return {
        processed,
        pagesFetched,
        totalMinutes: Math.round(totalMinutes),
        mavinMinutes: Math.round(mavinMinutes),
        creditableMinutes: Math.round(creditableMinutes),
        dailyCapReached: creditableMinutes < mavinMinutes,
        distinctTracksToday,
        varietyBonusApplied: varietyMultiplier > 1,
        pointsAwarded
    };
}

function sumPrevious(rowIds, idx, byId, creditableMinutes, effectiveRate) {
    let sum = 0;
    let creditedSoFar = 0;
    for (let i = 0; i < idx; i++) {
        const rowMins = (byId.get(rowIds[i]) || 0) / 60000;
        const remainingCreditable = Math.max(0, creditableMinutes - creditedSoFar);
        const rowCreditable = Math.min(rowMins, remainingCreditable);
        sum += Math.floor(rowCreditable * effectiveRate);
        creditedSoFar += rowCreditable;
    }
    return sum;
}

/**
 * Streaming stats from local DB.
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

// ─── LEGACY SHIMS ──────────────────────────────────────────────────────────
// Kept so external callers that imported old names don't break on this release.

/** @deprecated Legacy shim from Pathfix era — use getAuthorizationUrl. */
function generateState() { return crypto.randomBytes(16).toString('hex'); }
/** @deprecated Tokens live in spotify_connections now. */
function getConnection() { return null; }
/** @deprecated Use storeTokens. */
function saveConnection() {}
/** @deprecated No-op: Spotify has no user-level revoke endpoint. Use markDisconnected. */
async function disconnect(mavinUserId) { markDisconnected(mavinUserId); return true; }

module.exports = {
    // OAuth
    getAuthorizationUrl,
    signState,
    verifyState,
    exchangeCodeForTokens,
    refreshAccessToken,
    getValidAccessToken,
    storeTokens,
    // Connection state
    checkConnection,
    markConnected,
    markDisconnected,
    touchConnected,
    verifyConnection,
    // Data
    getSpotifyProfile,
    getRecentlyPlayed,
    getTopArtists,
    checkFollowsMavinArtists,
    processStreamingHistory,
    getStreamingStats,
    isMavinTrack,
    // Legacy shims
    generateState,
    getConnection,
    saveConnection,
    disconnect,
    // Mavin roster (back-compat getter)
    get MAVIN_ARTIST_IDS() {
        const ids = Array.from(artistService.getMavinSpotifyIds());
        return ids.length > 0 ? ids : LEGACY_MAVIN_ARTIST_IDS;
    }
};
