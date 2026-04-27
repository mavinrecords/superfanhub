/**
 * One-time migration script for Mavin SuperFan Hub.
 * Run ONCE before deploying updated application code:
 *
 *   node src/db/migrate.js
 *   (or: npm run migrate)
 *
 * Safe to re-run — every operation is guarded before executing.
 */

const { getDatabase } = require('./database');

function hasColumn(db, table, column) {
    const cols = db.pragma(`table_info(${table})`).map(c => c.name);
    return cols.includes(column);
}

function hasIndex(db, indexName) {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
    ).get(indexName);
    return !!row;
}

function hasTable(db, tableName) {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tableName);
    return !!row;
}

function toSlug(name) {
    return String(name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function titleCaseFromSlug(slug) {
    return String(slug)
        .split('-')
        .filter(Boolean)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
}

// Roster as of this migration. Spotify IDs for the first three come from the
// original MAVIN_ARTIST_IDS env var; the rest can be filled in via the admin
// endpoint (POST/PATCH /api/admin/artists). sort_order keeps display stable.
const KEEPER_ARTISTS = [
    { slug: 'rema',          display_name: 'Rema',          spotify_artist_id: '46pWGuE3dSwY3bMMXGBvVS', sort_order: 10 },
    { slug: 'ayra-starr',    display_name: 'Ayra Starr',    spotify_artist_id: '1wRPtKGflJrBx9BmLsSwlr', sort_order: 20 },
    { slug: 'johnny-drille', display_name: 'Johnny Drille', spotify_artist_id: null,                     sort_order: 30 },
    { slug: 'ladipoe',       display_name: 'LADIPOE',       spotify_artist_id: null,                     sort_order: 40 },
    { slug: 'magixx',        display_name: 'Magixx',        spotify_artist_id: null,                     sort_order: 50 },
    { slug: 'bayanni',       display_name: 'Bayanni',       spotify_artist_id: null,                     sort_order: 60 },
    { slug: 'boy-spyce',     display_name: 'Boy Spyce',     spotify_artist_id: null,                     sort_order: 70 },
    // New additions
    { slug: 'cupidszn',      display_name: 'CupidSZN',      spotify_artist_id: null,                     sort_order: 80 },
    { slug: 'lovn',          display_name: 'Lovn',          spotify_artist_id: null,                     sort_order: 90 }
];

// Slugs to hard-delete with cascade. The migration is idempotent — re-running
// after deletion is a no-op because the rows are already gone.
const REMOVE_SLUGS = ['crayon', 'lifesize-teddy'];

async function migrate() {
    const db = getDatabase();

    console.log('🔄 Starting database migration...');

    const run = db.transaction(() => {

        // ─────────────────────────────────────────────────────────
        // 1. referrals.referrer_user_id — add column if missing
        // ─────────────────────────────────────────────────────────
        if (!hasColumn(db, 'referrals', 'referrer_user_id')) {
            db.exec(`ALTER TABLE referrals ADD COLUMN referrer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
            console.log('  ✓ Added referrals.referrer_user_id');

            // Back-fill from users table where email matches
            const backfilled = db.prepare(`
                UPDATE referrals
                SET referrer_user_id = (
                    SELECT id FROM users WHERE users.email = referrals.referrer_email
                )
                WHERE referrer_user_id IS NULL
            `).run();
            console.log(`  ✓ Back-filled ${backfilled.changes} referral rows with user IDs`);
        } else {
            console.log('  – referrals.referrer_user_id already exists, skipping');
        }

        // ─────────────────────────────────────────────────────────
        // 2. admin_users.must_change_password — add column if missing
        // ─────────────────────────────────────────────────────────
        if (!hasColumn(db, 'admin_users', 'must_change_password')) {
            db.exec(`ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
            console.log('  ✓ Added admin_users.must_change_password');

            // Flag the default 'admin' account so they are forced to change on first login
            const flagged = db.prepare(`
                UPDATE admin_users SET must_change_password = 1 WHERE username = 'admin'
            `).run();
            if (flagged.changes > 0) {
                console.log('  ✓ Flagged default admin account for password change');
            }
        } else {
            console.log('  – admin_users.must_change_password already exists, skipping');
        }

        // ─────────────────────────────────────────────────────────
        // 3. Leaderboard composite index — add rank to existing index
        // ─────────────────────────────────────────────────────────
        if (hasIndex(db, 'idx_leaderboard_scope')) {
            db.exec(`DROP INDEX IF EXISTS idx_leaderboard_scope`);
            console.log('  ✓ Dropped old idx_leaderboard_scope');
        }
        if (!hasIndex(db, 'idx_leaderboard_scope')) {
            db.exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_scope ON leaderboard_cache(scope, scope_id, period, rank)`);
            console.log('  ✓ Created new idx_leaderboard_scope with rank column');
        }

        // ─────────────────────────────────────────────────────────
        // 4. Index: referrals.referrer_user_id
        // ─────────────────────────────────────────────────────────
        if (!hasIndex(db, 'idx_referrals_referrer_user_id')) {
            db.exec(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer_user_id ON referrals(referrer_user_id)`);
            console.log('  ✓ Created idx_referrals_referrer_user_id');
        }

        // ─────────────────────────────────────────────────────────
        // 5. artists table — create + back-fill + seed + hard-delete
        // ─────────────────────────────────────────────────────────
        console.log('\n  🎤 Artist roster migration:');

        // 5a. Create table (idempotent)
        db.exec(`
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                spotify_artist_id TEXT UNIQUE,
                active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 100,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_artists_active ON artists(active)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_artists_spotify ON artists(spotify_artist_id)`);
        console.log('    ✓ artists table + indexes ensured');

        // 5b. Back-fill — scan every table that uses artist_id as an FK string and
        //     insert any orphan slug into artists (active=0 so they don't leak
        //     into the frontend roster). This is what catches Lifesize Teddy if
        //     it exists anywhere.
        const tablesWithArtistId = [
            { table: 'tasks',                col: 'artist_id', nameCol: 'artist_name' },
            { table: 'squads',               col: 'artist_id', nameCol: 'artist_name' },
            { table: 'rewards',              col: 'artist_id', nameCol: 'artist_name' },
            { table: 'campaign_multipliers', col: 'artist_id', nameCol: null }
        ];
        const insertOrphan = db.prepare(`
            INSERT OR IGNORE INTO artists (slug, display_name, active, sort_order)
            VALUES (?, ?, 0, 1000)
        `);
        let backfillCount = 0;
        for (const { table, col, nameCol } of tablesWithArtistId) {
            if (!hasTable(db, table) || !hasColumn(db, table, col)) continue;
            const nameSelect = nameCol && hasColumn(db, table, nameCol) ? `, ${nameCol}` : '';
            const rows = db.prepare(
                `SELECT DISTINCT ${col}${nameSelect} FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`
            ).all();
            for (const row of rows) {
                const slug = toSlug(row[col]);
                if (!slug) continue;
                const displayName = (nameCol && row[nameCol])
                    ? row[nameCol]
                    : titleCaseFromSlug(slug);
                const info = insertOrphan.run(slug, displayName);
                if (info.changes > 0) {
                    backfillCount++;
                    console.log(`    ✓ back-filled artist "${slug}" (from ${table}) → inactive`);
                }
            }
        }
        // Also back-fill from user_profiles.favorite_artist (it's a free-text
        // string; most often matches an existing slug but may have stragglers).
        if (hasTable(db, 'user_profiles') && hasColumn(db, 'user_profiles', 'favorite_artist')) {
            const favs = db.prepare(`
                SELECT DISTINCT favorite_artist FROM user_profiles
                WHERE favorite_artist IS NOT NULL AND favorite_artist != ''
            `).all();
            for (const { favorite_artist } of favs) {
                const slug = toSlug(favorite_artist);
                if (!slug) continue;
                const info = insertOrphan.run(slug, titleCaseFromSlug(slug));
                if (info.changes > 0) {
                    backfillCount++;
                    console.log(`    ✓ back-filled artist "${slug}" (from user_profiles.favorite_artist) → inactive`);
                }
            }
        }
        console.log(`    → ${backfillCount} orphan artist(s) back-filled`);

        // 5c. Seed / upsert the current roster
        const upsertArtist = db.prepare(`
            INSERT INTO artists (slug, display_name, spotify_artist_id, active, sort_order)
            VALUES (@slug, @display_name, @spotify_artist_id, 1, @sort_order)
            ON CONFLICT(slug) DO UPDATE SET
                display_name      = excluded.display_name,
                spotify_artist_id = COALESCE(excluded.spotify_artist_id, artists.spotify_artist_id),
                active            = 1,
                sort_order        = excluded.sort_order,
                updated_at        = datetime('now')
        `);
        let seededCount = 0;
        for (const artist of KEEPER_ARTISTS) {
            const info = upsertArtist.run(artist);
            if (info.changes > 0) seededCount++;
        }
        console.log(`    ✓ seeded/updated ${seededCount} keeper artist row(s)`);

        // 5d. Hard-delete removed artists with cascade across all referencing tables.
        //     streaming_history has NO artist_id column (only artist_name joined
        //     string + is_mavin_artist flag), so we do not touch it — historical
        //     plays are immutable facts, and new plays won't credit because the
        //     artist is gone from the allowlist.
        const cascadeTables = [
            { table: 'tasks',                where: 'artist_id = ?' },
            { table: 'squads',               where: 'artist_id = ?' },
            { table: 'rewards',              where: 'artist_id = ?' },
            { table: 'campaign_multipliers', where: 'artist_id = ?' },
            { table: 'leaderboard_cache',    where: "scope = 'artist' AND scope_id = ?" }
        ];
        for (const slug of REMOVE_SLUGS) {
            const artistRow = db.prepare(
                'SELECT id, display_name FROM artists WHERE slug = ?'
            ).get(slug);

            // Always run the cascade even if the artist row isn't present —
            // orphan child rows may exist from older data.
            const counts = {};
            for (const { table, where } of cascadeTables) {
                if (!hasTable(db, table)) continue;
                const info = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(slug);
                counts[table] = info.changes;
            }

            let nulled = 0;
            if (hasTable(db, 'user_profiles') && hasColumn(db, 'user_profiles', 'favorite_artist')) {
                const info = db.prepare(
                    'UPDATE user_profiles SET favorite_artist = NULL WHERE favorite_artist = ? OR favorite_artist = ?'
                ).run(slug, artistRow?.display_name || slug);
                nulled = info.changes;
            }

            const delRow = db.prepare('DELETE FROM artists WHERE slug = ?').run(slug);

            const touched = delRow.changes + nulled + Object.values(counts).reduce((a, b) => a + b, 0);
            if (touched > 0) {
                console.log(`    🗑  hard-deleted artist "${slug}":`);
                for (const [table, n] of Object.entries(counts)) {
                    if (n > 0) console.log(`         – ${table}: ${n} row(s)`);
                }
                if (nulled > 0) console.log(`         – user_profiles.favorite_artist nulled: ${nulled}`);
                if (delRow.changes > 0) console.log(`         – artists row removed`);
            } else {
                console.log(`    – "${slug}" not present, skip`);
            }
        }

        // 5e. Sanity check
        const activeCount = db.prepare('SELECT COUNT(*) AS n FROM artists WHERE active = 1').get().n;
        console.log(`    → ${activeCount} active artist(s) now in roster`);
    });

    run();

    console.log('\n✅ Migration complete.');
    process.exit(0);
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
