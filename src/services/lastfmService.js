// Last.fm Integration Service — zero-OAuth power-user path (Phase 1.5).
//
// Why Last.fm?
//   Many power users already scrobble Spotify → Last.fm (or Apple Music → Last.fm,
//   or any player → Last.fm). Last.fm's public API is username-based: no per-user
//   OAuth flow required. The user types their username on the dashboard; we hit
//   ws.audioscrobbler.com/2.0/?method=user.getRecentTracks with our shared API
//   key. Zero friction, zero clicks, still real data.
//
// Design notes:
//   • Scrobbles land in the same `streaming_history` table as Spotify data, using
//     a synthetic `spotify_track_id` prefixed with `lf:` so the existing
//     getStreamingStats / daily-cap / variety-bonus logic works unchanged.
//   • Artist matching is NAME-based (normalized), since Last.fm doesn't expose
//     Spotify IDs. See artistService.getMavinArtistNames + normalizeArtistName.
//   • Duration isn't in recenttracks responses — we use a fixed 3.5min estimate
//     (ESTIMATED_TRACK_DURATION_MS). Average Afrobeats track length. Good enough
//     for points; anyone wanting minute-accurate numbers should use Spotify.
//   • Same fraud-prevention constants as Spotify (DAILY_MAVIN_MINUTES_CAP,
//     VARIETY_BONUS_MULTIPLIER, MAX_PAGES_PER_SYNC). Abuse surface identical.
//   • Last.fm rate limit is generous (~5 req/s) but we still use fetchWithRetry
//     for 429 safety.

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const artistService = require('./artistService');
const { fetchWithRetry } = require('./apiRetryHelper');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

// ─── POINTS / FRAUD (mirror Spotify's) ─────────────────────────────────────
const POINTS_PER_MINUTE = 1;
const BONUS_MULTIPLIER = {
    bronze: 1,
    silver: 1.2,
    gold: 1.5,
    platinum: 2,
    diamond: 2.5
};
const DAILY_MAVIN_MINUTES_CAP = 300;
const VARIETY_BONUS_THRESHOLD = 5;
const VARIETY_BONUS_MULTIPLIER = 1.1;
const MAX_PAGES_PER_SYNC = 5;

// Last.fm's recenttracks endpoint doesn't include track duration. Use a fixed
// estimate — average track length in Afrobeats/Pop. Matches the spirit of
// Spotify's duration_ms without a per-track track.getInfo call.
const ESTIMATED_TRACK_DURATION_MS = 210_000; // 3.5 minutes

// Last.fm page size (max 200 per request).
const PAGE_SIZE = 200;

// On a fresh /connect, only ingest the last 7 days of scrobbles. Spotify's
// recently-played only covers ~50 tracks anyway; keeping Last.fm in the same
// window prevents a single connect from demolishing the daily cap / tier math.
const INITIAL_SYNC_WINDOW_SEC = 7 * 24 * 60 * 60;

// ─── HTTP ──────────────────────────────────────────────────────────────────

/**
 * Low-level Last.fm API call. All methods use GET with query-string params.
 * Returns parsed JSON, or throws on non-2xx / Last.fm error payloads.
 *
 * Last.fm signals errors inside a 200 response with a top-level `error` field
 * (e.g. 6 = invalid user, 10 = invalid API key). We surface those as throws.
 */
async function lastfmRequest(method, params = {}) {
    if (!LASTFM_API_KEY) {
        throw new Error('LASTFM_API_KEY is not configured. See https://www.last.fm/api/account/create');
    }
    const qs = new URLSearchParams({
        method,
        api_key: LASTFM_API_KEY,
        format: 'json',
        ...params
    });
    const url = `${LASTFM_BASE}?${qs}`;

    const res = await fetchWithRetry(url, { method: 'GET' }, { label: 'lastfm' });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Last.fm API error ${res.status} on ${method}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data && typeof data.error === 'number') {
        // https://www.last.fm/api/errorcodes
        const msg = data.message || `Last.fm error ${data.error}`;
        const err = new Error(`Last.fm ${method}: ${msg}`);
        err.lastfmErrorCode = data.error;
        throw err;
    }
    return data;
}

// ─── CONNECTION STATE ──────────────────────────────────────────────────────

/**
 * Validate a Last.fm username via user.getInfo. Also returns richer profile
 * data we store in lastfm_connections. Throws if user doesn't exist.
 */
async function validateUsername(rawUsername) {
    const username = String(rawUsername || '').trim().toLowerCase();
    if (!username) throw new Error('Last.fm username is required');
    if (!/^[a-z0-9_\-]{2,50}$/i.test(username)) {
        throw new Error('Invalid Last.fm username format');
    }

    let data;
    try {
        data = await lastfmRequest('user.getInfo', { user: username });
    } catch (e) {
        if (e.lastfmErrorCode === 6) throw new Error(`Last.fm user "${username}" not found`);
        throw e;
    }
    const user = data?.user;
    if (!user?.name) throw new Error('Last.fm getInfo returned no user');

    return {
        username: user.name.toLowerCase(),   // normalize for storage (Last.fm is case-insensitive on lookup)
        display_name: user.realname || user.name,
        playcount: parseInt(user.playcount, 10) || 0,
        registered_unix: parseInt(user?.registered?.unixtime, 10) || null
    };
}

/**
 * Persist a verified Last.fm connection. UPSERT by user_id.
 * Doesn't do the sync itself — caller should invoke processScrobbles next.
 */
function storeConnection(mavinUserId, profile) {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO lastfm_connections
            (user_id, lastfm_username, display_name, playcount, registered_unix,
             last_sync_at, last_played_at_unix, total_mavin_scrobbles, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, 0, 0, datetime('now'), datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
            lastfm_username = excluded.lastfm_username,
            display_name = excluded.display_name,
            playcount = excluded.playcount,
            registered_unix = excluded.registered_unix,
            updated_at = datetime('now')
    `).run(
        mavinUserId,
        profile.username,
        profile.display_name || '',
        profile.playcount || 0,
        profile.registered_unix || null
    );
    console.log(`[Lastfm] storeConnection userId=${mavinUserId} username=${profile.username}`);
}

function getConnection(mavinUserId) {
    const db = getDatabase();
    return db.prepare(`
        SELECT * FROM lastfm_connections WHERE user_id = ?
    `).get(mavinUserId) || null;
}

function checkConnection(mavinUserId) {
    const row = getConnection(mavinUserId);
    if (!row) return { connected: false };
    return {
        connected: true,
        username: row.lastfm_username,
        displayName: row.display_name || row.lastfm_username,
        playcount: row.playcount || 0,
        lastSyncAt: row.last_sync_at,
        totalMavinScrobbles: row.total_mavin_scrobbles || 0
    };
}

function markDisconnected(mavinUserId) {
    const db = getDatabase();
    db.prepare(`DELETE FROM lastfm_connections WHERE user_id = ?`).run(mavinUserId);
    console.log(`[Lastfm] markDisconnected userId=${mavinUserId}`);
}

// ─── SCROBBLE FETCH ────────────────────────────────────────────────────────

/**
 * Get a page of recent tracks for a Last.fm user.
 * Docs: https://www.last.fm/api/show/user.getRecentTracks
 *
 * @param {string} username
 * @param {number} page          1-indexed
 * @param {number} [fromUnixSec] lower bound — only return scrobbles after this uts
 * @returns {Promise<{tracks: object[], totalPages: number, totalScrobbles: number}>}
 */
async function getRecentTracks(username, page = 1, fromUnixSec = 0) {
    const params = {
        user: username,
        limit: String(PAGE_SIZE),
        page: String(page)
    };
    if (fromUnixSec > 0) params.from = String(fromUnixSec);

    const data = await lastfmRequest('user.getRecentTracks', params);
    const rt = data?.recenttracks || {};
    const raw = rt.track;
    // Last.fm returns track as either an array (multi) or a single object (one track).
    const tracks = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const attr = rt['@attr'] || {};
    return {
        tracks,
        totalPages: parseInt(attr.totalPages, 10) || 1,
        totalScrobbles: parseInt(attr.total, 10) || 0
    };
}

// ─── MAVIN MATCHING ────────────────────────────────────────────────────────

/**
 * Is this Last.fm scrobble by a Mavin-roster artist?
 * Name-based match against the normalized allowlist.
 */
function isMavinScrobble(scrobble) {
    const artistName = scrobble?.artist?.['#text'] || scrobble?.artist?.name || '';
    if (!artistName) return false;
    const normalized = artistService.normalizeArtistName(artistName);
    if (!normalized) return false;
    const allowlist = artistService.getMavinArtistNames();
    return allowlist.has(normalized);
}

/**
 * Build the synthetic spotify_track_id we insert into streaming_history for a
 * Last.fm scrobble. Deterministic on (artist, track, uts) — same scrobble
 * always hashes the same, so the (user_id, spotify_track_id, played_at)
 * dedupe tuple in processStreamingHistory stays stable across repeat syncs.
 */
function buildScrobbleId(artistName, trackName, utsSec) {
    const input = `${artistName}|${trackName}|${utsSec}`;
    const hash = crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
    return `lf:${hash}`;
}

// ─── SYNC / POINTS ─────────────────────────────────────────────────────────

/**
 * Pull fresh scrobbles for a connected user, dedupe, write to streaming_history,
 * and award points respecting the shared daily cap + variety bonus.
 *
 * Pagination: starts at page 1 (most-recent-first) with `from = last_played_at_unix`.
 * Stops once we hit a scrobble older than the high-water mark, or MAX_PAGES_PER_SYNC
 * pages, whichever comes first.
 *
 * Returns a stats object shaped like Spotify's processStreamingHistory return
 * value so the UI can render both cards with one template.
 */
async function processScrobbles(mavinUserId, userTier = 'bronze') {
    const db = getDatabase();
    const connection = getConnection(mavinUserId);
    if (!connection) throw new Error('Last.fm not connected');

    const username = connection.lastfm_username;
    const highWaterUts = connection.last_played_at_unix || 0;

    // First-ever sync: clamp window to the last 7 days (mirrors Spotify's
    // recently-played window so initial connects don't dump years of history).
    const fromUts = highWaterUts > 0
        ? highWaterUts + 1 // +1 to avoid re-pulling the exact high-water row
        : Math.floor(Date.now() / 1000) - INITIAL_SYNC_WINDOW_SEC;

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
    let newestUtsThisSync = highWaterUts;
    const insertedMavinRowIds = [];

    for (let page = 1; page <= MAX_PAGES_PER_SYNC; page++) {
        const { tracks } = await getRecentTracks(username, page, fromUts);
        pagesFetched++;
        if (tracks.length === 0) break;

        for (const scrobble of tracks) {
            // Skip the "now playing" entry — no date field, not a completed play.
            if (scrobble?.['@attr']?.nowplaying === 'true') continue;
            if (!scrobble?.date?.uts) continue;

            const uts = parseInt(scrobble.date.uts, 10);
            if (!Number.isFinite(uts)) continue;

            const artistName = scrobble.artist?.['#text'] || scrobble.artist?.name || '';
            const trackName = scrobble.name || '';
            if (!artistName || !trackName) continue;

            const syntheticId = buildScrobbleId(artistName, trackName, uts);
            const playedAtIso = new Date(uts * 1000).toISOString();

            // Dedup (same scrobble could appear across pages on boundary cases).
            const existing = dedupeStmt.get(mavinUserId, syntheticId, playedAtIso);
            if (existing) continue;

            const isMavin = isMavinScrobble(scrobble);
            const durationMs = ESTIMATED_TRACK_DURATION_MS;
            const durationMinutes = durationMs / 60000;

            const info = insertStmt.run(
                mavinUserId,
                syntheticId,
                trackName,
                artistName,
                durationMs,
                playedAtIso,
                isMavin ? 1 : 0
            );
            processed++;
            totalMinutes += durationMinutes;
            if (isMavin) {
                mavinMinutes += durationMinutes;
                insertedMavinRowIds.push(info.lastInsertRowid);
            }

            if (uts > newestUtsThisSync) newestUtsThisSync = uts;
        }

        // Last.fm returns oldest-first within a page when `from` is set? No —
        // getRecentTracks returns newest-first always, and `from` filters.
        // If we have fewer than PAGE_SIZE results, we've reached the tail.
        if (tracks.length < PAGE_SIZE) break;
    }

    // ── Apply shared daily cap (matches Spotify math) ──────────────────────
    const todayMavinMins = db.prepare(`
        SELECT COALESCE(SUM(duration_ms), 0) / 60000.0 AS mins
        FROM streaming_history
        WHERE user_id = ? AND is_mavin_artist = 1 AND DATE(played_at) = DATE('now')
    `).get(mavinUserId)?.mins || 0;

    const todayBeforeSync = Math.max(0, todayMavinMins - mavinMinutes);
    const remainingBudget = Math.max(0, DAILY_MAVIN_MINUTES_CAP - todayBeforeSync);
    const creditableMinutes = Math.min(mavinMinutes, remainingBudget);

    const distinctTracksToday = db.prepare(`
        SELECT COUNT(DISTINCT spotify_track_id) AS n
        FROM streaming_history
        WHERE user_id = ? AND is_mavin_artist = 1 AND DATE(played_at) = DATE('now')
    `).get(mavinUserId)?.n || 0;

    const varietyMultiplier = distinctTracksToday >= VARIETY_BONUS_THRESHOLD
        ? VARIETY_BONUS_MULTIPLIER
        : 1;

    const tierMultiplier = BONUS_MULTIPLIER[userTier] || 1;
    const effectiveRate = POINTS_PER_MINUTE * tierMultiplier * varietyMultiplier;
    const pointsAwarded = Math.floor(creditableMinutes * effectiveRate);

    if (pointsAwarded > 0) {
        const loyaltyCardService = require('./loyaltyCardService');
        loyaltyCardService.addPoints(
            mavinUserId,
            pointsAwarded,
            'Last.fm streaming reward',
            'lastfm_streaming'
        );

        // Distribute per-row points_awarded so the history audit shows truth.
        if (insertedMavinRowIds.length > 0 && creditableMinutes > 0) {
            const rowDurations = db.prepare(
                `SELECT id, duration_ms FROM streaming_history WHERE id IN (${insertedMavinRowIds.map(() => '?').join(',')})`
            ).all(...insertedMavinRowIds);
            const byId = new Map(rowDurations.map(r => [r.id, r.duration_ms]));

            const updateStmt = db.prepare(`UPDATE streaming_history SET points_awarded = ? WHERE id = ?`);
            let creditedSoFar = 0;
            let pointsDistributed = 0;
            for (let i = 0; i < insertedMavinRowIds.length; i++) {
                const id = insertedMavinRowIds[i];
                const rowMins = (byId.get(id) || 0) / 60000;
                const isLast = i === insertedMavinRowIds.length - 1;
                const remainingCreditable = Math.max(0, creditableMinutes - creditedSoFar);
                const rowCreditable = Math.min(rowMins, remainingCreditable);
                const rowPoints = isLast
                    ? Math.max(0, pointsAwarded - pointsDistributed)
                    : Math.floor(rowCreditable * effectiveRate);
                creditedSoFar += rowCreditable;
                pointsDistributed += rowPoints;
                updateStmt.run(rowPoints, id);
            }
        }
    }

    // Update connection bookkeeping.
    const mavinInsertedCount = insertedMavinRowIds.length;
    db.prepare(`
        UPDATE lastfm_connections SET
            last_sync_at = datetime('now'),
            last_played_at_unix = ?,
            total_mavin_scrobbles = total_mavin_scrobbles + ?,
            updated_at = datetime('now')
        WHERE user_id = ?
    `).run(newestUtsThisSync, mavinInsertedCount, mavinUserId);

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

// ─── STATS ─────────────────────────────────────────────────────────────────

/**
 * Local DB stats for Last.fm specifically. Fast — no API call.
 * Filters streaming_history on the `lf:` synthetic-id prefix.
 */
function getScrobbleStats(mavinUserId) {
    const db = getDatabase();
    const stats = db.prepare(`
        SELECT
            COUNT(*)                                                       AS total_scrobbles,
            COUNT(CASE WHEN is_mavin_artist = 1 THEN 1 END)                AS mavin_scrobbles,
            SUM(duration_ms) / 60000.0                                     AS total_minutes,
            SUM(CASE WHEN is_mavin_artist = 1 THEN duration_ms ELSE 0 END)
                / 60000.0                                                  AS mavin_minutes
        FROM streaming_history
        WHERE user_id = ? AND spotify_track_id LIKE 'lf:%'
    `).get(mavinUserId);

    const connection = getConnection(mavinUserId);

    return {
        totalScrobbles: stats.total_scrobbles || 0,
        mavinScrobbles: stats.mavin_scrobbles || 0,
        totalMinutes: Math.round(stats.total_minutes || 0),
        mavinMinutes: Math.round(stats.mavin_minutes || 0),
        lastfmLifetimePlaycount: connection?.playcount || 0,
        lastSyncAt: connection?.last_sync_at || null
    };
}

module.exports = {
    // Connection
    validateUsername,
    storeConnection,
    getConnection,
    checkConnection,
    markDisconnected,
    // Data
    getRecentTracks,
    processScrobbles,
    getScrobbleStats,
    // Helpers (exported for unit tests)
    isMavinScrobble,
    buildScrobbleId,
    lastfmRequest
};
