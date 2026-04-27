// Artist Roster Service — single source of truth for the Mavin artist list.
//
// Used by:
//   • GET /api/artists (public, for frontend display)
//   • src/routes/artists.js admin CRUD
//   • src/services/spotifyService.js → isMavinTrack() stream allowlist
//
// Cache strategy: in-memory 60s TTL for the Spotify-ID Set used on the hot
// streaming-ingestion path. Cache is invalidated on any write.

const { getDatabase, runTransaction } = require('../db/database');

const CACHE_TTL_MS = 60 * 1000;
let spotifyIdCache = null;
let spotifyIdCacheExpiresAt = 0;
let artistNameCache = null;
let artistNameCacheExpiresAt = 0;

function toSlug(name) {
    return String(name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Normalize an artist name for name-based matching (used by Last.fm where
 * we don't have a Spotify ID). Lowercases, strips accents, collapses
 * whitespace, removes punctuation. Example: "Ayrá  Starr!" → "ayra starr".
 */
function normalizeArtistName(name) {
    return String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ') // replace punctuation with space
        .replace(/\s+/g, ' ')               // collapse whitespace
        .trim();
}

function invalidateCache() {
    spotifyIdCache = null;
    spotifyIdCacheExpiresAt = 0;
    artistNameCache = null;
    artistNameCacheExpiresAt = 0;
}

/**
 * @returns {Array<{id,slug,display_name,spotify_artist_id,active,sort_order}>}
 */
function listActiveArtists() {
    const db = getDatabase();
    return db.prepare(`
        SELECT id, slug, display_name, spotify_artist_id, active, sort_order, created_at, updated_at
        FROM artists
        WHERE active = 1
        ORDER BY sort_order ASC, display_name ASC
    `).all();
}

/**
 * @returns {Array} all artists, active + inactive (admin-only).
 */
function listAllArtists() {
    const db = getDatabase();
    return db.prepare(`
        SELECT id, slug, display_name, spotify_artist_id, active, sort_order, created_at, updated_at
        FROM artists
        ORDER BY active DESC, sort_order ASC, display_name ASC
    `).all();
}

function getArtistBySlug(slug) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM artists WHERE slug = ?').get(slug) || null;
}

/**
 * @returns {Set<string>} Spotify artist IDs for every ACTIVE artist that has one.
 * Cached for CACHE_TTL_MS to keep the hot streaming path cheap.
 */
function getMavinSpotifyIds() {
    const now = Date.now();
    if (spotifyIdCache && now < spotifyIdCacheExpiresAt) {
        return spotifyIdCache;
    }
    const db = getDatabase();
    const rows = db.prepare(
        `SELECT spotify_artist_id FROM artists WHERE active = 1 AND spotify_artist_id IS NOT NULL AND spotify_artist_id != ''`
    ).all();
    spotifyIdCache = new Set(rows.map(r => r.spotify_artist_id));
    spotifyIdCacheExpiresAt = now + CACHE_TTL_MS;
    return spotifyIdCache;
}

/**
 * @returns {Set<string>} normalized display_names of every ACTIVE artist.
 * Used by the Last.fm ingestion path (no Spotify IDs available in scrobbles;
 * we match by artist name instead). Shares the 60s TTL cache window.
 *
 * Normalization collapses accents, punctuation, and case — so a Last.fm
 * scrobble crediting "Ayra Starr", "ayra starr", or "AYRA STARR" all match.
 */
function getMavinArtistNames() {
    const now = Date.now();
    if (artistNameCache && now < artistNameCacheExpiresAt) {
        return artistNameCache;
    }
    const db = getDatabase();
    const rows = db.prepare(
        `SELECT display_name FROM artists WHERE active = 1 AND display_name IS NOT NULL AND display_name != ''`
    ).all();
    artistNameCache = new Set(rows.map(r => normalizeArtistName(r.display_name)).filter(Boolean));
    artistNameCacheExpiresAt = now + CACHE_TTL_MS;
    return artistNameCache;
}

/**
 * Create a new artist. slug is derived from display_name if not provided.
 * Returns the inserted row.
 */
function addArtist({ display_name, spotify_artist_id = null, slug = null, sort_order = 100, active = 1 }) {
    if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
        throw new Error('display_name is required');
    }
    const finalSlug = slug || toSlug(display_name);
    if (!finalSlug) throw new Error('could not derive a valid slug from display_name');

    const db = getDatabase();
    const info = db.prepare(`
        INSERT INTO artists (slug, display_name, spotify_artist_id, active, sort_order)
        VALUES (?, ?, ?, ?, ?)
    `).run(finalSlug, display_name.trim(), spotify_artist_id || null, active ? 1 : 0, sort_order);

    invalidateCache();
    return db.prepare('SELECT * FROM artists WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Patch fields on an existing artist. Fields omitted from `patch` are untouched.
 * Returns the updated row, or null if slug didn't exist.
 */
function updateArtist(slug, patch) {
    const db = getDatabase();
    const current = getArtistBySlug(slug);
    if (!current) return null;

    const fields = [];
    const values = [];
    if (patch.display_name !== undefined) {
        fields.push('display_name = ?');
        values.push(String(patch.display_name).trim());
    }
    if (patch.spotify_artist_id !== undefined) {
        fields.push('spotify_artist_id = ?');
        values.push(patch.spotify_artist_id || null);
    }
    if (patch.active !== undefined) {
        fields.push('active = ?');
        values.push(patch.active ? 1 : 0);
    }
    if (patch.sort_order !== undefined) {
        fields.push('sort_order = ?');
        values.push(Number(patch.sort_order));
    }
    if (fields.length === 0) return current;
    fields.push(`updated_at = datetime('now')`);
    values.push(slug);

    db.prepare(`UPDATE artists SET ${fields.join(', ')} WHERE slug = ?`).run(...values);
    invalidateCache();
    return getArtistBySlug(slug);
}

/**
 * Hard-delete an artist and cascade across every table that references them.
 * Same cascade logic that migrate.js uses. Returns per-table row counts.
 *
 * streaming_history is intentionally NOT touched — historical plays are
 * immutable facts. Removing the artist from the allowlist prevents new credit.
 *
 * loyalty_transactions are NOT touched — we don't claw back earned points.
 */
function deleteArtist(slug) {
    const db = getDatabase();
    const artist = getArtistBySlug(slug);

    return runTransaction(() => {
        const counts = {};

        counts.tasks                 = db.prepare('DELETE FROM tasks WHERE artist_id = ?').run(slug).changes;
        counts.squads                = db.prepare('DELETE FROM squads WHERE artist_id = ?').run(slug).changes;
        counts.rewards               = db.prepare('DELETE FROM rewards WHERE artist_id = ?').run(slug).changes;
        counts.campaign_multipliers  = db.prepare('DELETE FROM campaign_multipliers WHERE artist_id = ?').run(slug).changes;
        counts.leaderboard_cache     = db.prepare(
            `DELETE FROM leaderboard_cache WHERE scope = 'artist' AND scope_id = ?`
        ).run(slug).changes;

        counts.user_profiles_nulled = db.prepare(
            'UPDATE user_profiles SET favorite_artist = NULL WHERE favorite_artist = ? OR favorite_artist = ?'
        ).run(slug, artist?.display_name || slug).changes;

        counts.artists_deleted = db.prepare('DELETE FROM artists WHERE slug = ?').run(slug).changes;

        invalidateCache();
        return { slug, artist, counts };
    });
}

module.exports = {
    listActiveArtists,
    listAllArtists,
    getArtistBySlug,
    getMavinSpotifyIds,
    getMavinArtistNames,
    normalizeArtistName,
    addArtist,
    updateArtist,
    deleteArtist,
    invalidateCache,
    toSlug
};
