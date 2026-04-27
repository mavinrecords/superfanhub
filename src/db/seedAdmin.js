const bcrypt = require('bcrypt');
const { getDatabase } = require('./database');

/**
 * Idempotent admin seed. Runs on server boot and from the `npm run init-db` CLI.
 *
 * Behavior:
 *   - If an admin user with the seed username already exists → no-op (silent).
 *   - If ADMIN_PASSWORD env var is set (≥ 8 chars) → seed with those creds, no forced rotation.
 *   - If ADMIN_PASSWORD is unset → seed with `admin` / `admin123` + must_change_password=1.
 *   - If ADMIN_PASSWORD is set but invalid (< 8 chars) → log error, do nothing, do NOT crash.
 *
 * Safe to call repeatedly. Synchronous (uses bcrypt.hashSync) so it can run inside
 * the existing sync server boot without an async refactor.
 *
 * @param {{ silent?: boolean }} opts
 * @returns {{ created: boolean, username: string, usingDefaults: boolean } | null}
 */
function seedAdminIfNeeded(opts = {}) {
    const { silent = false } = opts;
    const log = silent ? () => {} : (...args) => console.log(...args);
    const warn = silent ? () => {} : (...args) => console.warn(...args);
    const error = silent ? () => {} : (...args) => console.error(...args);

    const seedUsername = process.env.ADMIN_USERNAME || 'admin';
    const envPassword = process.env.ADMIN_PASSWORD;
    const usingDefaults = !envPassword;
    const seedPassword = envPassword || 'admin123';

    if (envPassword && envPassword.length < 8) {
        error(`[admin-seed] ADMIN_PASSWORD is set but only ${envPassword.length} chars — needs ≥ 8. Skipping seed.`);
        return null;
    }

    let db;
    try {
        db = getDatabase();
    } catch (err) {
        error('[admin-seed] DB not ready, skipping:', err.message);
        return null;
    }

    const existingAdmin = db
        .prepare('SELECT id FROM admin_users WHERE username = ?')
        .get(seedUsername);

    if (existingAdmin) {
        log(`[admin-seed] Admin "${seedUsername}" already exists — leaving credentials untouched.`);
        return { created: false, username: seedUsername, usingDefaults };
    }

    const passwordHash = bcrypt.hashSync(seedPassword, 12);

    const cols = db.pragma('table_info(admin_users)').map((c) => c.name);
    const hasMustChangeColumn = cols.includes('must_change_password');
    const mustChange = usingDefaults ? 1 : 0;

    if (hasMustChangeColumn) {
        db.prepare(
            `INSERT INTO admin_users (username, password_hash, role, must_change_password)
             VALUES (?, ?, 'superadmin', ?)`
        ).run(seedUsername, passwordHash, mustChange);
    } else {
        db.prepare(
            `INSERT INTO admin_users (username, password_hash, role)
             VALUES (?, ?, 'superadmin')`
        ).run(seedUsername, passwordHash);
    }

    if (usingDefaults) {
        warn(`[admin-seed] Created default admin "${seedUsername}" with password "admin123".`);
        warn('[admin-seed] You will be forced to rotate this on first login. Set ADMIN_PASSWORD env var to skip the default.');
    } else {
        log(`[admin-seed] Created admin "${seedUsername}" from ADMIN_USERNAME / ADMIN_PASSWORD env vars (no forced rotation).`);
    }

    return { created: true, username: seedUsername, usingDefaults };
}

module.exports = { seedAdminIfNeeded };
